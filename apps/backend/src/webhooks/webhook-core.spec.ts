import { createHmac } from "node:crypto";
import {
  buildEnvelope,
  generateWebhookSecret,
  isValidEventPattern,
  MAX_ATTEMPTS,
  nextAttemptDelayMs,
  RETRY_DELAYS_MS,
  signPayload,
  subscriptionWants,
  toSnakeCase,
  verifySignature,
  webhookUrlProblem,
} from "./webhook-core";

describe("assinatura dos webhooks", () => {
  const secret = "whsec_segredo-de-teste";
  const body = '{"id":"e1","type":"lead.created"}';

  it("formato t=<unix>,v1=<hmac sha256 de 't.corpo'> (vetor calculado à parte)", () => {
    const expected = createHmac("sha256", secret).update(`1700000000.${body}`).digest("hex");
    expect(signPayload(secret, body, 1700000000)).toBe(`t=1700000000,v1=${expected}`);
  });

  it("verifySignature aceita a assinatura certa dentro da tolerância", () => {
    const header = signPayload(secret, body, 1700000000);
    expect(verifySignature(secret, body, header, 300, 1700000100)).toBe(true);
  });

  it("recusa corpo adulterado, segredo errado, carimbo adulterado, fora da tolerância e lixo", () => {
    const header = signPayload(secret, body, 1700000000);
    expect(verifySignature(secret, body + " ", header, 300, 1700000000)).toBe(false);
    expect(verifySignature("outro-segredo", body, header, 300, 1700000000)).toBe(false);
    expect(verifySignature(secret, body, header.replace("t=1700000000", "t=1700000001"), 300, 1700000000)).toBe(false);
    expect(verifySignature(secret, body, header, 300, 1700000000 + 301)).toBe(false);
    for (const bad of [undefined, "", "v1=abc", "t=x,v1=y", `t=1700000000,v1=${"0".repeat(63)}`]) {
      expect(verifySignature(secret, body, bad, 300, 1700000000)).toBe(false);
    }
  });

  it("os segredos gerados são únicos e têm o prefixo", () => {
    const a = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(generateWebhookSecret());
  });
});

describe("repetição com recuo", () => {
  it("segue a tabela de esperas e esgota depois da última", () => {
    const fixed = () => 0.5; // sem variação
    expect(RETRY_DELAYS_MS.map((_, i) => nextAttemptDelayMs(i + 1, fixed))).toEqual(RETRY_DELAYS_MS);
    expect(nextAttemptDelayMs(MAX_ATTEMPTS, fixed)).toBeNull();
    expect(nextAttemptDelayMs(MAX_ATTEMPTS + 5, fixed)).toBeNull();
  });

  it("a variação aleatória fica entre -20% e +20%", () => {
    expect(nextAttemptDelayMs(1, () => 0)).toBe(48_000);
    expect(nextAttemptDelayMs(1, () => 1)).toBe(72_000);
  });
});

describe("eventos", () => {
  it("nomes válidos: '*' ou recurso.acao em minúsculas", () => {
    for (const ok of ["*", "lead.created", "deal.stage_changed", "automation.meu_evento", "a.b.c"]) expect(isValidEventPattern(ok)).toBe(true);
    for (const bad of ["", "lead", "Lead.Created", "lead.*", "lead created", "lead.", ".created", "**"]) expect(isValidEventPattern(bad)).toBe(false);
  });

  it("uma subscrição recebe o que pediu, ou tudo com '*'", () => {
    expect(subscriptionWants(["lead.created"], "lead.created")).toBe(true);
    expect(subscriptionWants(["lead.created"], "deal.created")).toBe(false);
    expect(subscriptionWants(["*"], "qualquer.coisa")).toBe(true);
    expect(subscriptionWants([], "lead.created")).toBe(false);
  });
});

describe("envelope", () => {
  it("converte as chaves para snake_case em profundidade, datas para ISO e respeita toJSON (Decimal)", () => {
    const decimal = { toJSON: () => "1500.50" };
    Object.setPrototypeOf(decimal, { isDecimal: true });
    const date = new Date("2026-11-12T10:00:00.000Z");
    expect(
      toSnakeCase({ leadId: "l1", companyName: "Acme", nested: { fromStageName: "Novo", list: [{ dealId: "d1" }] }, value: decimal, when: date, nada: null }),
    ).toEqual({
      lead_id: "l1",
      company_name: "Acme",
      nested: { from_stage_name: "Novo", list: [{ deal_id: "d1" }] },
      value: "1500.50",
      when: "2026-11-12T10:00:00.000Z",
      nada: null,
    });
  });

  it("tem id único, tipo, versão 1 e data ISO", () => {
    const now = new Date("2026-11-12T10:00:00.000Z");
    const a = buildEnvelope("lead.created", { leadId: "l1" }, now);
    const b = buildEnvelope("lead.created", { leadId: "l1" }, now);
    expect(a).toMatchObject({ type: "lead.created", version: 1, occurred_at: "2026-11-12T10:00:00.000Z", data: { lead_id: "l1" } });
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.id).not.toBe(b.id);
  });
});

describe("webhookUrlProblem", () => {
  it("aceita http/https, incluindo endereços da rede local (o n8n está lá)", () => {
    for (const ok of ["http://192.168.50.10:5678/webhook/abc", "https://exemplo.pt/hook", "http://localhost:5678/x", "http://n8n.local/hook?x=1"]) {
      expect(webhookUrlProblem(ok)).toBeNull();
    }
  });

  it("recusa outros esquemas, credenciais embutidas e lixo", () => {
    for (const bad of ["ftp://exemplo.pt/x", "file:///etc/passwd", "javascript:alert(1)", "http://user:pass@exemplo.pt/x", "nao-e-url", ""]) {
      expect(webhookUrlProblem(bad)).not.toBeNull();
    }
  });
});
