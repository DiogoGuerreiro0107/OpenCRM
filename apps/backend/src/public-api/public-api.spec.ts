import { HttpException, HttpStatus, NotFoundException } from "@nestjs/common";
import { API_KEY_PREFIX, extractBearer, generateApiKey, hashApiKey, looksLikeApiKey } from "../api-keys/api-key";
import { isValidIdempotencyKey, requestFingerprint, stableStringify } from "./idempotency";
import { SlidingWindowLimiter } from "./rate-limiter";
import { ApiError, V1ExceptionFilter } from "./v1-error.filter";
import { publicCompany, publicContact, publicLead } from "./mappers";

describe("chaves de API", () => {
  it("formato: ocrm_ + 43 caracteres, aleatória, e o hash é SHA-256 em hexadecimal", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(/^ocrm_[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.prefix).toBe(a.key.slice(0, 8));
    expect(a.prefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashApiKey(a.key));
    expect(a.hash).not.toContain(a.key);
  });

  it("looksLikeApiKey recusa lixo", () => {
    expect(looksLikeApiKey(generateApiKey().key)).toBe(true);
    for (const bad of [undefined, null, "", "ocrm_curta", "xxxx_" + "a".repeat(43), `ocrm_${"a".repeat(44)}`, `ocrm_${"a".repeat(42)}!`]) {
      expect(looksLikeApiKey(bad as never)).toBe(false);
    }
  });

  it("extractBearer só aceita Authorization: Bearer <token>", () => {
    expect(extractBearer("Bearer abc")).toBe("abc");
    expect(extractBearer("bearer abc")).toBe("abc");
    for (const bad of [undefined, "", "abc", "Basic abc", "Bearer", "Bearer a b"]) expect(extractBearer(bad)).toBeNull();
  });
});

describe("SlidingWindowLimiter", () => {
  it("deixa passar até ao limite e recusa o seguinte, com Retry-After", () => {
    let now = 1_000_000;
    const limiter = new SlidingWindowLimiter(() => now);
    expect(limiter.consume("k", 3).allowed).toBe(true);
    now += 1000;
    expect(limiter.consume("k", 3).allowed).toBe(true);
    now += 1000;
    expect(limiter.consume("k", 3).allowed).toBe(true);
    now += 1000;
    const refused = limiter.consume("k", 3);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(57); // o primeiro pedido sai da janela 60 s depois de feito
  });

  it("volta a deixar passar quando a janela avança; cada chave tem o seu limite", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(() => now);
    limiter.consume("a", 1);
    expect(limiter.consume("a", 1).allowed).toBe(false);
    expect(limiter.consume("b", 1).allowed).toBe(true);
    now += 60_000;
    expect(limiter.consume("a", 1).allowed).toBe(true);
  });

  it("pedidos recusados não prolongam o bloqueio", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(() => now);
    limiter.consume("a", 1);
    for (let i = 0; i < 20; i++) {
      now += 1000;
      limiter.consume("a", 1);
    }
    now = 60_000;
    expect(limiter.consume("a", 1).allowed).toBe(true);
  });

  it("prune esquece chaves inativas", () => {
    let now = 0;
    const limiter = new SlidingWindowLimiter(() => now);
    limiter.consume("a", 5);
    now += 61_000;
    limiter.prune();
    expect(limiter.consume("a", 1).allowed).toBe(true);
  });
});

describe("idempotência (funções puras)", () => {
  it("stableStringify ignora a ordem das chaves e os undefined", () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: undefined } })).toBe(stableStringify({ a: { d: [1, 2] }, b: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("a impressão digital depende do método, do caminho e do corpo", () => {
    const base = requestFingerprint("POST", "/api/v1/leads", { name: "Ana" });
    expect(requestFingerprint("post", "/api/v1/leads", { name: "Ana" })).toBe(base);
    expect(requestFingerprint("POST", "/api/v1/leads", { name: "Ana", x: undefined })).toBe(base);
    expect(requestFingerprint("POST", "/api/v1/leads", { name: "Rui" })).not.toBe(base);
    expect(requestFingerprint("POST", "/api/v1/outro", { name: "Ana" })).not.toBe(base);
    expect(requestFingerprint("POST", "/api/v1/leads", undefined)).toBe(requestFingerprint("POST", "/api/v1/leads", {}));
  });

  it("valida o Idempotency-Key", () => {
    expect(isValidIdempotencyKey("a1b2c3d4-e5f6")).toBe(true);
    for (const bad of ["curto", "tem espaço aqui", "x".repeat(129), "", undefined, 5, "acentuação-áé"]) expect(isValidIdempotencyKey(bad)).toBe(false);
  });
});

describe("V1ExceptionFilter", () => {
  const run = (exception: unknown) => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    new V1ExceptionFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as never);
    return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
  };

  it("formato único com código estável por estado", () => {
    expect(run(new NotFoundException("Empresa não encontrada"))).toEqual({
      status: 404,
      body: { error: { code: "not_found", message: "Empresa não encontrada" } },
    });
    expect(run(new HttpException("x", HttpStatus.TOO_MANY_REQUESTS)).body.error.code).toBe("rate_limited");
    expect(run(new HttpException("x", HttpStatus.UNAUTHORIZED)).body.error.code).toBe("unauthorized");
    expect(run(new HttpException("x", HttpStatus.FORBIDDEN)).body.error.code).toBe("insufficient_scope");
  });

  it("erros de validação trazem a lista em `details`", () => {
    const result = run(new HttpException({ message: ["name deve ser texto", "email inválido"], error: "Bad Request" }, 400));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: { code: "invalid_request", message: "Pedido inválido", details: ["name deve ser texto", "email inválido"] } });
  });

  it("ApiError usa o código explícito", () => {
    expect(run(new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_reuse", "reutilizado")).body.error.code).toBe("idempotency_key_reuse");
  });

  it("erros desconhecidos dão 500 genérico, sem revelar a mensagem", () => {
    const result = run(new Error("segredo interno: connection string xyz"));
    expect(result.status).toBe(500);
    expect(JSON.stringify(result.body)).not.toContain("xyz");
    expect(result.body.error.code).toBe("internal_error");
  });
});

describe("representações públicas", () => {
  const date = new Date("2026-11-11T10:00:00.000Z");

  it("em snake_case, só com campos escolhidos e datas ISO (nunca ownerId nem campos internos)", () => {
    const company = publicCompany({ id: "c1", name: "Acme", legalName: "Acme Lda", ownerId: "u1", notes: "interno", createdAt: date, updatedAt: date } as never);
    expect(company).toMatchObject({ id: "c1", legal_name: "Acme Lda", created_at: date.toISOString() });
    expect(Object.keys(company)).not.toContain("ownerId");
    expect(JSON.stringify(company)).not.toContain("interno");

    const contact = publicContact({ id: "p1", name: "Ana", companyId: "c1", ownerId: "u1", notes: "interno", mobilePhone: "9", createdAt: date, updatedAt: date } as never);
    expect(contact).toMatchObject({ company_id: "c1", mobile_phone: "9" });
    expect(JSON.stringify(contact)).not.toContain("interno");

    const lead = publicLead({ id: "l1", name: "X", responsavelId: "u1", convertedDealId: "d1", createdAt: date, updatedAt: date } as never);
    expect(Object.keys(lead)).not.toContain("responsavelId");
    expect(Object.keys(lead)).not.toContain("convertedDealId");
  });
});
