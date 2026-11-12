import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";
import { IdempotencyInterceptor } from "../src/public-api/idempotency.interceptor";

// Chaves de API e API pública /api/v1 (pacote E0c, docs/plano-e0-api-publica.md).
describe("API pública /api/v1 e chaves de API (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await prisma().moduleSetting.deleteMany();
    await app.get(ModulesService).reload();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const setupAdmin = async () => {
    const admin = await createUser(prisma(), "ADMINISTRADOR", "Ana Admin");
    return { admin, auth: await bearerFor(app, admin) };
  };

  /** Cria uma chave pela API de gestão (como o Administrador faria) e devolve a chave em claro. */
  async function makeKey(auth: string, body: Record<string, unknown> = {}) {
    const res = await api()
      .post("/api-keys")
      .set("Authorization", auth)
      .send({ name: "Loja online", scopes: ["companies:read", "contacts:read", "leads:write"], ...body })
      .expect(201);
    return { key: res.body.key as string, id: res.body.id as string, body: res.body };
  }

  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

  describe("gestão de chaves (Administrador)", () => {
    it("criar devolve a chave UMA vez; na base de dados só fica o hash; a lista nunca a mostra", async () => {
      const { admin, auth } = await setupAdmin();
      const { key, id, body } = await makeKey(auth, { expiresAt: new Date(Date.now() + 86_400_000).toISOString(), rateLimitPerMinute: 60 });

      expect(key).toMatch(/^ocrm_[A-Za-z0-9_-]{43}$/);
      expect(body).toMatchObject({ name: "Loja online", status: "active", rateLimitPerMinute: 60, createdById: admin.id, prefix: key.slice(0, 8) });
      expect(body.keyHash).toBeUndefined();

      const stored = await prisma().apiKey.findUniqueOrThrow({ where: { id } });
      expect(stored.keyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(key);

      const list = await api().get("/api-keys").set("Authorization", auth).expect(200);
      expect(list.body).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain(key);
      expect(JSON.stringify(list.body)).not.toContain("keyHash");
    });

    it("a criação e a revogação ficam na auditoria, sem a chave", async () => {
      const { admin, auth } = await setupAdmin();
      const { key, id } = await makeKey(auth);
      await api().post(`/api-keys/${id}/revoke`).set("Authorization", auth).expect(200);

      const created = await prisma().auditEvent.findFirstOrThrow({ where: { action: "api_key.created" } });
      expect(created).toMatchObject({ actorId: admin.id, targetId: id, targetType: "api_key" });
      expect(created.metadata).toMatchObject({ name: "Loja online", scopes: ["companies:read", "contacts:read", "leads:write"] });
      expect(await prisma().auditEvent.findFirstOrThrow({ where: { action: "api_key.revoked" } })).toMatchObject({ targetId: id });

      const all = JSON.stringify(await prisma().auditEvent.findMany());
      expect(all).not.toContain(key);
    });

    it("valida o corpo: âmbito desconhecido, sem âmbitos, expiração no passado, limite fora do intervalo", async () => {
      const { auth } = await setupAdmin();
      const post = (body: Record<string, unknown>) => api().post("/api-keys").set("Authorization", auth).send({ name: "x", scopes: ["leads:write"], ...body });
      await post({ scopes: ["admin:tudo"] }).expect(400);
      await post({ scopes: [] }).expect(400);
      await post({ scopes: ["leads:write", "leads:write"] }).expect(400);
      await post({ expiresAt: new Date(Date.now() - 1000).toISOString() }).expect(400);
      await post({ rateLimitPerMinute: 0 }).expect(400);
      await post({ rateLimitPerMinute: 1001 }).expect(400);
      await post({ name: "" }).expect(400);
      expect(await prisma().apiKey.count()).toBe(0);
    });

    it("só o Administrador gere chaves; sem sessão dá 401", async () => {
      const { auth } = await setupAdmin();
      const { id } = await makeKey(auth);
      await api().get("/api-keys").expect(401);
      for (const role of ["COMERCIAL", "TECNICO", "BACKOFFICE", "FINANCEIRO", "LEITURA_APENAS"] as const) {
        const other = await bearerFor(app, await createUser(prisma(), role));
        await api().get("/api-keys").set("Authorization", other).expect(403);
        await api().get("/api-keys/scopes").set("Authorization", other).expect(403);
        await api().post("/api-keys").set("Authorization", other).send({ name: "x", scopes: ["leads:write"] }).expect(403);
        await api().post(`/api-keys/${id}/revoke`).set("Authorization", other).expect(403);
      }
      expect(await prisma().apiKey.count()).toBe(1);
    });

    it("lista os âmbitos disponíveis; revogar duas vezes é inofensivo; id inexistente dá 404", async () => {
      const { auth } = await setupAdmin();
      const scopes = await api().get("/api-keys/scopes").set("Authorization", auth).expect(200);
      expect(scopes.body.map((s: { scope: string }) => s.scope).sort()).toEqual(["companies:read", "contacts:read", "leads:write"]);

      const { id } = await makeKey(auth);
      const first = await api().post(`/api-keys/${id}/revoke`).set("Authorization", auth).expect(200);
      const second = await api().post(`/api-keys/${id}/revoke`).set("Authorization", auth).expect(200);
      expect(first.body.status).toBe("revoked");
      expect(second.body.revokedAt).toBe(first.body.revokedAt);
      await api().post("/api-keys/00000000-0000-4000-8000-000000000000/revoke").set("Authorization", auth).expect(404);
    });
  });

  describe("autenticação da API pública", () => {
    const UNAUTHORIZED = { error: { code: "unauthorized", message: "Chave de API em falta ou inválida" } };

    it("sem chave, com lixo, inexistente, revogada ou expirada: o MESMO 401", async () => {
      const { auth } = await setupAdmin();
      const revoked = await makeKey(auth);
      await api().post(`/api-keys/${revoked.id}/revoke`).set("Authorization", auth).expect(200);
      const expired = await makeKey(auth);
      await prisma().apiKey.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const valid = await makeKey(auth);

      const attempts: Array<Record<string, string>> = [
        {},
        { Authorization: "Bearer lixo" },
        { Authorization: `Bearer ocrm_${"a".repeat(43)}` }, // formato certo, não existe
        { Authorization: "Basic abc" },
        bearer(revoked.key),
        bearer(expired.key),
      ];
      for (const headers of attempts) {
        const res = await api().get("/api/v1/ping").set(headers).expect(401);
        expect(res.body).toEqual(UNAUTHORIZED);
      }
      await api().get("/api/v1/ping").set(bearer(valid.key)).expect(200);
    });

    it("as duas portas nunca se misturam: JWT na /api/v1 e chave na API da interface dão 401", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      await api().get("/api/v1/ping").set("Authorization", auth).expect(401);
      await api().get("/companies").set(bearer(key)).expect(401);
      await api().get("/api-keys").set(bearer(key)).expect(401);
      await api().post("/leads").set(bearer(key)).send({ name: "x" }).expect(401);
    });

    it("ping mostra a identidade e os âmbitos da chave e regista a última utilização", async () => {
      const { auth } = await setupAdmin();
      const { key, id } = await makeKey(auth, { name: "Conector n8n", scopes: ["companies:read"] });
      const res = await api().get("/api/v1/ping").set(bearer(key)).expect(200);
      expect(res.body.data).toMatchObject({ api_version: "v1", api_key: { id, name: "Conector n8n", scopes: ["companies:read"] } });
      expect(JSON.stringify(res.body)).not.toContain(key);

      for (let i = 0; i < 20 && !(await prisma().apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect((await prisma().apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt).not.toBeNull();
    });

    it("âmbito em falta dá 403 insufficient_scope", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth, { scopes: ["companies:read"] });
      const res = await api().get("/api/v1/contacts").set(bearer(key)).expect(403);
      expect(res.body.error.code).toBe("insufficient_scope");
      await api().post("/api/v1/leads").set({ ...bearer(key), "Idempotency-Key": "chave-de-teste-1" }).send({ name: "x" }).expect(403);
      await api().get("/api/v1/companies").set(bearer(key)).expect(200);
    });

    it("limite por chave: 429 com Retry-After; outra chave não é afetada", async () => {
      const { auth } = await setupAdmin();
      const limited = await makeKey(auth, { name: "limitada", rateLimitPerMinute: 3 });
      const other = await makeKey(auth, { name: "outra" });

      for (let i = 0; i < 3; i++) await api().get("/api/v1/ping").set(bearer(limited.key)).expect(200);
      const refused = await api().get("/api/v1/ping").set(bearer(limited.key)).expect(429);
      expect(refused.body.error.code).toBe("rate_limited");
      expect(Number(refused.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      await api().get("/api/v1/ping").set(bearer(other.key)).expect(200);
    });

    it("revogar tem efeito imediato", async () => {
      const { auth } = await setupAdmin();
      const { key, id } = await makeKey(auth);
      await api().get("/api/v1/ping").set(bearer(key)).expect(200);
      await api().post(`/api-keys/${id}/revoke`).set("Authorization", auth).expect(200);
      await api().get("/api/v1/ping").set(bearer(key)).expect(401);
    });
  });

  describe("leitura: empresas e contactos", () => {
    const seedCompanies = async (count: number) => {
      for (let i = 0; i < count; i++) {
        await prisma().company.create({
          data: { name: `Empresa ${i}`, notes: "nota interna", updatedAt: new Date(Date.UTC(2026, 10, 1, 10, i)) },
        });
      }
    };

    it("pagina por cursor em ordem de alteração (crescente), sem repetir nem saltar", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      await seedCompanies(5);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await api().get("/api/v1/companies").query({ limit: 2, ...(cursor ? { cursor } : {}) }).set(bearer(key)).expect(200);
        seen.push(...res.body.data.map((c: { name: string }) => c.name));
        cursor = res.body.next_cursor;
        pages++;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(seen).toEqual(["Empresa 0", "Empresa 1", "Empresa 2", "Empresa 3", "Empresa 4"]);
    });

    it("updated_since devolve só o que mudou; linhas com a mesma data não se perdem entre páginas", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      await seedCompanies(5);
      const since = await api().get("/api/v1/companies").query({ updated_since: "2026-11-01T10:03:00.000Z" }).set(bearer(key)).expect(200);
      expect(since.body.data.map((c: { name: string }) => c.name)).toEqual(["Empresa 3", "Empresa 4"]);

      const same = new Date(Date.UTC(2026, 10, 2));
      for (let i = 0; i < 4; i++) await prisma().contact.create({ data: { name: `Contacto ${i}`, updatedAt: same } });
      const ids = new Set<string>();
      let cursor: string | null = null;
      do {
        const res: request.Response = await api().get("/api/v1/contacts").query({ limit: 1, ...(cursor ? { cursor } : {}) }).set(bearer(key)).expect(200);
        res.body.data.forEach((c: { id: string }) => ids.add(c.id));
        cursor = res.body.next_cursor;
      } while (cursor && ids.size < 10);
      expect(ids.size).toBe(4);
    });

    it("forma pública: snake_case, sem campos internos; GET por id e 404 no formato de erro", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      const company = await prisma().company.create({ data: { name: "Acme", legalName: "Acme Lda", taxId: "500100200", notes: "nota interna", ownerId: (await prisma().user.findFirstOrThrow()).id } });

      const res = await api().get(`/api/v1/companies/${company.id}`).set(bearer(key)).expect(200);
      expect(res.body.data).toMatchObject({ id: company.id, name: "Acme", legal_name: "Acme Lda", tax_id: "500100200" });
      expect(Object.keys(res.body.data)).not.toEqual(expect.arrayContaining(["ownerId", "notes", "legalName"]));
      expect(JSON.stringify(res.body)).not.toContain("nota interna");

      const missing = await api().get("/api/v1/companies/00000000-0000-4000-8000-000000000000").set(bearer(key)).expect(404);
      expect(missing.body).toEqual({ error: { code: "not_found", message: "Empresa não encontrada" } });
    });

    it("parâmetros inválidos dão 400 invalid_request com detalhes", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      for (const query of [{ limit: 0 }, { limit: 101 }, { updated_since: "ontem" }]) {
        const res = await api().get("/api/v1/companies").query(query).set(bearer(key)).expect(400);
        expect(res.body.error.code).toBe("invalid_request");
        expect(Array.isArray(res.body.error.details)).toBe(true);
      }
    });
  });

  describe("POST /api/v1/leads e idempotência", () => {
    const lead = (extra: Record<string, unknown> = {}) => ({ name: "Maria Silva", email: "maria@e2e.test", phone: "912345678", ...extra });
    const post = (key: string, idem: string | undefined, body: Record<string, unknown>) =>
      api()
        .post("/api/v1/leads")
        .set({ ...bearer(key), ...(idem ? { "Idempotency-Key": idem } : {}) })
        .send(body);

    it("Idempotency-Key é obrigatório e tem de ser válido", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      const missing = await post(key, undefined, lead()).expect(400);
      expect(missing.body.error).toMatchObject({ code: "invalid_request" });
      await post(key, "curto", lead()).expect(400);
      expect(await prisma().lead.count()).toBe(0);
    });

    it("cria o lead como na interface: estado novo, origem «API: <nome>», tarefa para quem criou a chave", async () => {
      const { admin, auth } = await setupAdmin();
      const { key } = await makeKey(auth, { name: "Formulário do site" });
      const res = await post(key, "formulario-0001", lead({ interest: "IMPRESSAO", notes: "Quer um orçamento" })).expect(201);

      expect(res.body.data).toMatchObject({ name: "Maria Silva", email: "maria@e2e.test", status: "NOVO", source: "API: Formulário do site", notes: "Quer um orçamento" });
      expect(Object.keys(res.body.data)).not.toContain("responsavelId");

      const task = await prisma().task.findFirstOrThrow({ where: { leadId: res.body.data.id } });
      expect(task).toMatchObject({ assigneeId: admin.id, status: "PENDING" });
      expect(task.title).toContain("Maria Silva");
    });

    it("o corpo não escolhe estado nem responsável (campos desconhecidos são ignorados); a origem pode ser dada", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      const res = await post(key, "formulario-0002", lead({ status: "CONVERTIDO", responsavelId: "x", source: "Landing de Natal" })).expect(201);
      expect(res.body.data).toMatchObject({ status: "NOVO", source: "Landing de Natal" });
      expect((await prisma().lead.findUniqueOrThrow({ where: { id: res.body.data.id } })).responsavelId).toBeNull();
    });

    it("repetir o mesmo pedido devolve a MESMA resposta e não duplica nada", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      const first = await post(key, "repetir-0001", lead()).expect(201);
      expect(first.headers["idempotent-replayed"]).toBeUndefined();

      const again = await post(key, "repetir-0001", lead()).expect(201);
      expect(again.headers["idempotent-replayed"]).toBe("true");
      expect(again.body).toEqual(first.body);

      // a ordem das chaves do JSON não conta
      const reordered = await post(key, "repetir-0001", { phone: "912345678", email: "maria@e2e.test", name: "Maria Silva" }).expect(201);
      expect(reordered.body).toEqual(first.body);

      expect(await prisma().lead.count()).toBe(1);
      expect(await prisma().task.count()).toBe(1);
    });

    it("a mesma Idempotency-Key com outro corpo dá 422 e não cria nada", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      await post(key, "reutilizado-1", lead()).expect(201);
      const res = await post(key, "reutilizado-1", lead({ name: "Outra Pessoa" })).expect(422);
      expect(res.body.error.code).toBe("idempotency_key_reuse");
      expect(await prisma().lead.count()).toBe(1);
    });

    it("o escopo é a chave de API: duas integrações podem usar o mesmo texto", async () => {
      const { auth } = await setupAdmin();
      const a = await makeKey(auth, { name: "A" });
      const b = await makeKey(auth, { name: "B" });
      await post(a.key, "mesmo-texto-1", lead()).expect(201);
      const res = await post(b.key, "mesmo-texto-1", lead()).expect(201);
      expect(res.headers["idempotent-replayed"]).toBeUndefined();
      expect(await prisma().lead.count()).toBe(2);
    });

    it("um pedido que falha NÃO fica guardado: corrigir e repetir com a mesma chave executa", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      const bad = await post(key, "corrigir-0001", { email: "nao-e-email" }).expect(400);
      expect(bad.body.error.code).toBe("invalid_request");
      expect(await prisma().idempotencyRecord.count()).toBe(0);

      await post(key, "corrigir-0001", lead()).expect(201);
      expect(await prisma().lead.count()).toBe(1);
    });

    it("pedidos iguais em simultâneo criam no máximo UM lead", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      const results = await Promise.all(Array.from({ length: 4 }, () => post(key, "simultaneo-01", lead())));
      const statuses = results.map((r) => r.status);
      expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
      expect(statuses).toContain(201);
      expect(await prisma().lead.count()).toBe(1);
      const created = results.filter((r) => r.status === 201 && !r.headers["idempotent-replayed"]);
      expect(created).toHaveLength(1);
    });

    it("um registo «em curso» abandonado (backend caiu a meio) é libertado e o pedido executa", async () => {
      const { auth } = await setupAdmin();
      const { key, id } = await makeKey(auth);
      const fingerprint = (await import("../src/public-api/idempotency")).requestFingerprint("POST", "/api/v1/leads", lead());
      await prisma().idempotencyRecord.create({
        data: { apiKeyId: id, key: "abandonado-01", method: "POST", path: "/api/v1/leads", requestHash: fingerprint, createdAt: new Date(Date.now() - 10 * 60_000) },
      });
      await post(key, "abandonado-01", lead()).expect(201);
      expect(await prisma().lead.count()).toBe(1);
    });

    it("um registo «em curso» recente dá 409", async () => {
      const { auth } = await setupAdmin();
      const { key, id } = await makeKey(auth);
      const fingerprint = (await import("../src/public-api/idempotency")).requestFingerprint("POST", "/api/v1/leads", lead());
      await prisma().idempotencyRecord.create({
        data: { apiKeyId: id, key: "em-curso-001", method: "POST", path: "/api/v1/leads", requestHash: fingerprint },
      });
      const res = await post(key, "em-curso-001", lead()).expect(409);
      expect(res.body.error.code).toBe("conflict");
      expect(await prisma().lead.count()).toBe(0);
    });

    it("a limpeza diária apaga registos com mais de 24 h e mantém os recentes", async () => {
      const { auth } = await setupAdmin();
      const { key, id } = await makeKey(auth);
      await post(key, "recente-0001", lead()).expect(201);
      await prisma().idempotencyRecord.create({
        data: { apiKeyId: id, key: "antigo-00001", method: "POST", path: "/x", requestHash: "h", status: 201, createdAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      await app.get(IdempotencyInterceptor).purgeOld();
      const remaining = await prisma().idempotencyRecord.findMany();
      expect(remaining.map((r) => r.key)).toEqual(["recente-0001"]);
    });

    it("com o módulo de leads desligado a rota responde 404 (no formato de erro); ao ligar volta a funcionar", async () => {
      const { auth } = await setupAdmin();
      const { key } = await makeKey(auth);
      await api().patch("/modules/leads").set("Authorization", auth).send({ enabled: false }).expect(200);
      const off = await post(key, "modulo-off-01", lead()).expect(404);
      expect(off.body.error.code).toBe("not_found");
      expect(await prisma().lead.count()).toBe(0);

      await api().patch("/modules/leads").set("Authorization", auth).send({ enabled: true }).expect(200);
      await post(key, "modulo-off-01", lead()).expect(201);
    });

    it("sem chave válida o módulo desligado não se revela (401 e não 404)", async () => {
      await setupAdmin();
      await prisma().moduleSetting.create({ data: { moduleId: "leads", enabled: false } });
      await app.get(ModulesService).reload();
      await api().post("/api/v1/leads").set({ "Idempotency-Key": "sem-chave-001" }).send(lead()).expect(401);
    });
  });
});
