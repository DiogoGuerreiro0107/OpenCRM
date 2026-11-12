import * as http from "node:http";
import { AddressInfo } from "node:net";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";
import { WebhookDispatcher } from "../src/webhooks/webhook-dispatcher.service";
import { CIRCUIT_BREAKER_THRESHOLD, MAX_ATTEMPTS, verifySignature } from "../src/webhooks/webhook-core";
import { deriveKey, isEncrypted } from "../src/common/secrets";
import { countPlaintextSecrets, encryptStoredSecrets } from "../src/common/secrets-migration";

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Um destino de webhooks de faz-de-conta: guarda o que recebe e responde o que o teste mandar. */
async function startReceiver() {
  const received: Received[] = [];
  const state = { status: 200, location: undefined as string | undefined, responseBody: "ok" };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.statusCode = state.status;
      if (state.location) res.setHeader("Location", state.location);
      res.end(state.responseBody);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  return { received, state, url, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, what: string, timeoutMs = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Tempo esgotado à espera de: ${what}`);
    await new Promise((r) => setTimeout(r, 40));
  }
}

// Eventos e webhooks de saída (pacote E0d, docs/plano-e0-api-publica.md).
describe("Webhooks de saída (e2e)", () => {
  let app: INestApplication;
  let receiver: Awaited<ReturnType<typeof startReceiver>>;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  const dispatcher = () => app.get(WebhookDispatcher);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    receiver = await startReceiver();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await receiver.close();
  });

  afterAll(async () => {
    await app.close();
  });

  const setupAdmin = async () => {
    const admin = await createUser(prisma(), "ADMINISTRADOR", "Ana Admin");
    return { admin, auth: await bearerFor(app, admin) };
  };

  async function subscribe(auth: string, body: Record<string, unknown> = {}) {
    const res = await api()
      .post("/webhooks/subscriptions")
      .set("Authorization", auth)
      .send({ name: "n8n", url: receiver.url, events: ["lead.created"], ...body })
      .expect(201);
    return res.body as { id: string; secret: string; name: string };
  }

  const createLead = (auth: string, name = "Maria Silva") =>
    api().post("/leads").set("Authorization", auth).send({ name, email: "maria@e2e.test", companyName: "Acme Lda" }).expect(201);

  const deliveryOf = (subscriptionId: string) => prisma().webhookDelivery.findFirst({ where: { subscriptionId }, orderBy: { createdAt: "desc" } });
  const settled = (subscriptionId: string, status: string) =>
    waitFor(async () => {
      const d = await deliveryOf(subscriptionId);
      return d && d.status === status && d.lockedUntil === null ? d : null;
    }, `entrega ${status}`);

  describe("gestão de subscrições (Administrador)", () => {
    it("criar devolve o segredo UMA vez; fica cifrado na base de dados; a lista nunca o mostra", async () => {
      const { auth } = await setupAdmin();
      const created = await subscribe(auth);
      expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

      const stored = await prisma().webhookSubscription.findUniqueOrThrow({ where: { id: created.id } });
      expect(isEncrypted(stored.secret)).toBe(true);
      expect(stored.secret).not.toContain(created.secret);
      expect(await countPlaintextSecrets(prisma())).toBe(0);

      const list = await api().get("/webhooks/subscriptions").set("Authorization", auth).expect(200);
      expect(list.body).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain(created.secret);
      expect(list.body[0].secret).toBeUndefined();
    });

    it("a auditoria regista a criação sem o URL nem o segredo", async () => {
      const { admin, auth } = await setupAdmin();
      const created = await subscribe(auth);
      const event = await prisma().auditEvent.findFirstOrThrow({ where: { action: "webhook.created" } });
      expect(event).toMatchObject({ actorId: admin.id, targetId: created.id, metadata: { name: "n8n", events: ["lead.created"] } });
      const all = JSON.stringify(await prisma().auditEvent.findMany());
      expect(all).not.toContain(created.secret);
      expect(all).not.toContain(receiver.url);
    });

    it("valida o URL e os eventos", async () => {
      const { auth } = await setupAdmin();
      const post = (body: Record<string, unknown>) =>
        api().post("/webhooks/subscriptions").set("Authorization", auth).send({ name: "x", url: receiver.url, events: ["lead.created"], ...body });
      await post({ url: "ftp://exemplo.pt/x" }).expect(400);
      await post({ url: "http://user:pass@exemplo.pt/x" }).expect(400);
      await post({ url: "nao-e-url" }).expect(400);
      await post({ events: [] }).expect(400);
      await post({ events: ["Lead Created"] }).expect(400);
      await post({ events: ["lead.*"] }).expect(400);
      await post({ name: "" }).expect(400);
      expect(await prisma().webhookSubscription.count()).toBe(0);
      await post({ events: ["*"] }).expect(201);
    });

    it("só o Administrador gere e VÊ webhooks; sem sessão dá 401", async () => {
      const { auth } = await setupAdmin();
      const { id } = await subscribe(auth);
      await api().get("/webhooks/subscriptions").expect(401);
      for (const role of ["COMERCIAL", "TECNICO", "BACKOFFICE", "FINANCEIRO", "LEITURA_APENAS"] as const) {
        const other = await bearerFor(app, await createUser(prisma(), role));
        await api().get("/webhooks/subscriptions").set("Authorization", other).expect(403);
        await api().get("/webhooks/deliveries").set("Authorization", other).expect(403);
        await api().get("/webhooks/events").set("Authorization", other).expect(403);
        await api().post("/webhooks/subscriptions").set("Authorization", other).send({ name: "x", url: receiver.url, events: ["*"] }).expect(403);
        await api().patch(`/webhooks/subscriptions/${id}`).set("Authorization", other).send({ active: false }).expect(403);
        await api().delete(`/webhooks/subscriptions/${id}`).set("Authorization", other).expect(403);
        await api().post(`/webhooks/subscriptions/${id}/rotate-secret`).set("Authorization", other).expect(403);
        await api().post(`/webhooks/subscriptions/${id}/test`).set("Authorization", other).expect(403);
      }
      expect(await prisma().webhookSubscription.count()).toBe(1);
    });

    it("apagar remove a subscrição e as suas entregas; fica na auditoria", async () => {
      const { auth } = await setupAdmin();
      const { id } = await subscribe(auth);
      await createLead(auth);
      await settled(id, "DELIVERED");

      await api().delete(`/webhooks/subscriptions/${id}`).set("Authorization", auth).expect(204);
      expect(await prisma().webhookSubscription.count()).toBe(0);
      expect(await prisma().webhookDelivery.count()).toBe(0);
      expect(await prisma().auditEvent.count({ where: { action: "webhook.deleted", targetId: id } })).toBe(1);
      await api().delete(`/webhooks/subscriptions/${id}`).set("Authorization", auth).expect(404);
    });
  });

  describe("entrega", () => {
    it("um evento real chega assinado, com o envelope em snake_case", async () => {
      const { auth } = await setupAdmin();
      const { id, secret } = await subscribe(auth);
      const lead = await createLead(auth);
      const delivery = await settled(id, "DELIVERED");

      expect(receiver.received).toHaveLength(1);
      const { headers, body } = receiver.received[0];
      expect(headers["content-type"]).toContain("application/json");
      expect(headers["x-opencrm-event"]).toBe("lead.created");
      expect(headers["x-opencrm-delivery"]).toBe(delivery.id);
      expect(headers["user-agent"]).toBe("OpenCRM-Webhooks/1");
      expect(verifySignature(secret, body, headers["x-opencrm-signature"] as string)).toBe(true);
      expect(verifySignature("whsec_outro", body, headers["x-opencrm-signature"] as string)).toBe(false);

      const envelope = JSON.parse(body);
      expect(envelope).toMatchObject({
        id: delivery.eventId,
        type: "lead.created",
        version: 1,
        data: { lead_id: lead.body.id, name: "Maria Silva", company_name: "Acme Lda", email: "maria@e2e.test" },
      });
      expect(new Date(envelope.occurred_at).getTime()).not.toBeNaN();
      expect(Object.keys(envelope.data)).not.toContain("leadId");

      expect(delivery).toMatchObject({ attempts: 1, lastStatusCode: 200, lastError: null });
      const subscription = await prisma().webhookSubscription.findUniqueOrThrow({ where: { id } });
      expect(subscription.lastSuccessAt).not.toBeNull();
      expect(subscription.consecutiveFailures).toBe(0);
    });

    it("só recebe os eventos que subscreveu; '*' recebe todos; inativa não recebe nada", async () => {
      const { auth } = await setupAdmin();
      const onlyDeals = await subscribe(auth, { name: "só negócios", events: ["deal.created"] });
      const everything = await subscribe(auth, { name: "tudo", events: ["*"] });
      const inactive = await subscribe(auth, { name: "inativa", events: ["*"] });
      await api().patch(`/webhooks/subscriptions/${inactive.id}`).set("Authorization", auth).send({ active: false }).expect(200);

      await createLead(auth);
      await settled(everything.id, "DELIVERED");

      expect(await prisma().webhookDelivery.count({ where: { subscriptionId: onlyDeals.id } })).toBe(0);
      expect(await prisma().webhookDelivery.count({ where: { subscriptionId: inactive.id } })).toBe(0);
      expect(receiver.received).toHaveLength(1);
    });

    it("o mesmo evento tem o mesmo id em todas as subscrições (para deduplicar)", async () => {
      const { auth } = await setupAdmin();
      const a = await subscribe(auth, { name: "A" });
      const b = await subscribe(auth, { name: "B" });
      await createLead(auth);
      const [da, db] = [await settled(a.id, "DELIVERED"), await settled(b.id, "DELIVERED")];
      expect(da.eventId).toBe(db.eventId);
      expect(da.id).not.toBe(db.id);
    });

    it("evento de teste chega mesmo que a subscrição não o tenha pedido", async () => {
      const { auth } = await setupAdmin();
      const { id } = await subscribe(auth, { events: ["deal.created"] });
      await api().post(`/webhooks/subscriptions/${id}/test`).set("Authorization", auth).expect(200);
      await settled(id, "DELIVERED");
      expect(JSON.parse(receiver.received[0].body)).toMatchObject({ type: "webhook.test", data: { subscription_name: "n8n" } });
    });

    it("publicar um evento nunca atrasa nem faz falhar a operação principal", async () => {
      const { auth } = await setupAdmin();
      await subscribe(auth);
      jest.spyOn(dispatcher(), "enqueue").mockRejectedValue(new Error("fila indisponível"));
      await createLead(auth); // 201 apesar do erro na fila
      expect(await prisma().lead.count()).toBe(1);
    });
  });

  describe("falhas, repetição e reenvio", () => {
    it("falha → fica na fila com recuo; quando o destino recupera, a repetição entrega o MESMO evento", async () => {
      const { auth } = await setupAdmin();
      const { id } = await subscribe(auth);
      receiver.state.status = 500;
      receiver.state.responseBody = "corpo-secreto-do-destino";
      await createLead(auth);

      const failed = await waitFor(async () => {
        const d = await deliveryOf(id);
        return d && d.attempts === 1 && d.lockedUntil === null ? d : null;
      }, "primeira tentativa falhada");
      expect(failed).toMatchObject({ status: "PENDING", lastStatusCode: 500, lastError: "HTTP 500" });
      const wait = failed.nextAttemptAt.getTime() - Date.now();
      expect(wait).toBeGreaterThan(40_000); // 1 min ±20%
      expect(wait).toBeLessThan(75_000);
      // nunca se guarda o corpo da resposta do destino
      expect(JSON.stringify(failed)).not.toContain("corpo-secreto-do-destino");
      expect((await prisma().webhookSubscription.findUniqueOrThrow({ where: { id } })).consecutiveFailures).toBe(1);

      // ainda não chegou a hora: o agendador não lhe toca
      await dispatcher().processDue();
      expect(receiver.received).toHaveLength(1);

      receiver.state.status = 200;
      await prisma().webhookDelivery.update({ where: { id: failed.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await dispatcher().processDue();

      const delivered = await settled(id, "DELIVERED");
      expect(delivered.attempts).toBe(2);
      expect(receiver.received).toHaveLength(2);
      const [first, second] = receiver.received.map((r) => JSON.parse(r.body));
      expect(second.id).toBe(first.id);
      expect(receiver.received[1].headers["x-opencrm-delivery"]).toBe(receiver.received[0].headers["x-opencrm-delivery"]);
      expect((await prisma().webhookSubscription.findUniqueOrThrow({ where: { id } })).consecutiveFailures).toBe(0);
    });

    it("esgotadas as tentativas fica FALHADA e deixa de ser repetida", async () => {
      const { auth } = await setupAdmin();
      const { id } = await subscribe(auth);
      receiver.state.status = 503;
      await createLead(auth);
      const first = await waitFor(async () => {
        const d = await deliveryOf(id);
        return d && d.attempts === 1 && d.lockedUntil === null ? d : null;
      }, "primeira tentativa");

      await prisma().webhookDelivery.update({ where: { id: first.id }, data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(Date.now() - 1000) } });
      await dispatcher().processDue();
      const dead = await settled(id, "FAILED");
      expect(dead.attempts).toBe(MAX_ATTEMPTS);

      const before = receiver.received.length;
      await dispatcher().processDue();
      expect(receiver.received).toHaveLength(before);
    });

    it("destino inacessível: regista o erro de rede sem estado HTTP", async () => {
      const { auth } = await setupAdmin();
      await receiver.close(); // ninguém à escuta nesta porta
      const { id } = await subscribe(auth);
      await createLead(auth);
      const failed = await waitFor(async () => {
        const d = await deliveryOf(id);
        return d && d.attempts === 1 && d.lockedUntil === null ? d : null;
      }, "tentativa falhada");
      expect(failed.lastStatusCode).toBeNull();
      expect(failed.lastError).toMatch(/ECONNREFUSED/);
      receiver = await startReceiver(); // para o afterEach fechar algo válido
    });

    it("não segue redirecionamentos: o evento não vai parar a outro sítio", async () => {
      const { auth } = await setupAdmin();
      const elsewhere = await startReceiver();
      try {
        receiver.state.status = 302;
        receiver.state.location = elsewhere.url;
        const { id } = await subscribe(auth);
        await createLead(auth);
        const failed = await waitFor(async () => {
          const d = await deliveryOf(id);
          return d && d.attempts === 1 && d.lockedUntil === null ? d : null;
        }, "tentativa");
        expect(failed).toMatchObject({ status: "PENDING", lastStatusCode: 302 });
        expect(elsewhere.received).toHaveLength(0);
      } finally {
        await elsewhere.close();
      }
    });

    it("reenviar cria uma entrega NOVA com o mesmo evento; a original fica como estava", async () => {
      const { auth } = await setupAdmin();
      const { id } = await subscribe(auth);
      receiver.state.status = 500;
      await createLead(auth);
      const first = await waitFor(async () => {
        const d = await deliveryOf(id);
        return d && d.attempts === 1 && d.lockedUntil === null ? d : null;
      }, "primeira tentativa");
      await api().post(`/webhooks/deliveries/${first.id}/redeliver`).set("Authorization", auth).expect(400); // ainda na fila

      await prisma().webhookDelivery.update({ where: { id: first.id }, data: { status: "FAILED" } });
      receiver.state.status = 200;
      const res = await api().post(`/webhooks/deliveries/${first.id}/redeliver`).set("Authorization", auth).expect(200);
      expect(res.body.id).not.toBe(first.id);
      expect(res.body.eventId).toBe(first.eventId);

      await waitFor(async () => (await prisma().webhookDelivery.findUnique({ where: { id: res.body.id } }))?.status === "DELIVERED", "reenvio entregue");
      expect((await prisma().webhookDelivery.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("FAILED");
      expect(await prisma().auditEvent.count({ where: { action: "webhook.delivery_retried" } })).toBe(1);
      await api().post("/webhooks/deliveries/00000000-0000-4000-8000-000000000000/redeliver").set("Authorization", auth).expect(404);
    });

    it("a mesma entrega nunca é enviada em duplicado por tentativas concorrentes", async () => {
      const { auth } = await setupAdmin();
      const { id } = await subscribe(auth);
      const delivery = await prisma().webhookDelivery.create({
        data: { subscriptionId: id, eventId: "evt-1", eventType: "lead.created", payload: { id: "evt-1", type: "lead.created", version: 1, data: {} } },
      });
      const results = await Promise.all(Array.from({ length: 6 }, () => dispatcher().attempt(delivery.id)));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(receiver.received).toHaveLength(1);
      expect((await prisma().webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("DELIVERED");
    });
  });

  describe("disjuntor e segredo", () => {
    it(`${CIRCUIT_BREAKER_THRESHOLD} falhas seguidas desativam a subscrição; reativar à mão repõe a contagem`, async () => {
      const { auth } = await setupAdmin();
      const { id } = await subscribe(auth);
      await prisma().webhookSubscription.update({ where: { id }, data: { consecutiveFailures: CIRCUIT_BREAKER_THRESHOLD - 1 } });
      receiver.state.status = 500;
      await createLead(auth);

      const disabled = await waitFor(async () => {
        const s = await prisma().webhookSubscription.findUniqueOrThrow({ where: { id } });
        return s.active ? null : s;
      }, "subscrição desativada");
      expect(disabled.disabledReason).toContain(`${CIRCUIT_BREAKER_THRESHOLD} falhas`);
      const audit = await waitFor(() => prisma().auditEvent.findFirst({ where: { action: "webhook.auto_disabled" } }), "auditoria do disjuntor");
      expect(audit).toMatchObject({ actorId: null, targetId: id });

      // desativada: eventos novos não criam entregas, e o teste é recusado
      const before = await prisma().webhookDelivery.count();
      await createLead(auth, "Outro Lead");
      await new Promise((r) => setTimeout(r, 200));
      expect(await prisma().webhookDelivery.count()).toBe(before);
      await api().post(`/webhooks/subscriptions/${id}/test`).set("Authorization", auth).expect(400);

      const reactivated = await api().patch(`/webhooks/subscriptions/${id}`).set("Authorization", auth).send({ active: true }).expect(200);
      expect(reactivated.body).toMatchObject({ active: true, consecutiveFailures: 0, disabledReason: null });
    });

    it("rodar o segredo: o antigo deixa de verificar, o novo passa a verificar", async () => {
      const { auth } = await setupAdmin();
      const { id, secret: oldSecret } = await subscribe(auth);
      const rotated = await api().post(`/webhooks/subscriptions/${id}/rotate-secret`).set("Authorization", auth).expect(200);
      const newSecret = rotated.body.secret as string;
      expect(newSecret).toMatch(/^whsec_/);
      expect(newSecret).not.toBe(oldSecret);

      await createLead(auth);
      await settled(id, "DELIVERED");
      const { headers, body } = receiver.received[0];
      expect(verifySignature(newSecret, body, headers["x-opencrm-signature"] as string)).toBe(true);
      expect(verifySignature(oldSecret, body, headers["x-opencrm-signature"] as string)).toBe(false);

      const all = JSON.stringify(await prisma().auditEvent.findMany());
      expect(all).not.toContain(newSecret);
    });

    it("o comando secrets:encrypt também trata os segredos dos webhooks (rotação da SECRETS_KEY)", async () => {
      const { auth } = await setupAdmin();
      await subscribe(auth);
      const appKey = deriveKey(process.env.SECRETS_KEY!);
      const newKey = deriveKey("chave-nova-de-testes-com-mais-de-32-caracteres");
      const report = await encryptStoredSecrets(prisma(), [newKey, appKey]);
      expect(report.find((r) => r.field === "WebhookSubscription.secret")).toMatchObject({ recrypted: 1, encrypted: 0 });
    });
  });

  describe("registo de entregas", () => {
    it("lista por subscrição e estado, do mais recente para o mais antigo, sem o envelope", async () => {
      const { auth } = await setupAdmin();
      const { id } = await subscribe(auth);
      await createLead(auth, "Primeiro");
      await waitFor(async () => (await prisma().webhookDelivery.count({ where: { status: "DELIVERED" } })) === 1, "1.ª entrega");
      receiver.state.status = 500;
      await createLead(auth, "Segundo");
      await waitFor(async () => (await prisma().webhookDelivery.count({ where: { attempts: 1, status: "PENDING", lockedUntil: null } })) === 1, "2.ª entrega");

      const all = await api().get("/webhooks/deliveries").query({ subscriptionId: id }).set("Authorization", auth).expect(200);
      expect(all.body.items.map((d: { status: string }) => d.status)).toEqual(["PENDING", "DELIVERED"]);
      expect(all.body.items[0].payload).toBeUndefined();
      expect(all.body.items[0].nextAttemptAt).not.toBeNull();
      expect(all.body.items[1].nextAttemptAt).toBeNull();

      const delivered = await api().get("/webhooks/deliveries").query({ status: "DELIVERED" }).set("Authorization", auth).expect(200);
      expect(delivered.body.items).toHaveLength(1);

      const page1 = await api().get("/webhooks/deliveries").query({ limit: 1 }).set("Authorization", auth).expect(200);
      const page2 = await api().get("/webhooks/deliveries").query({ limit: 1, cursor: page1.body.nextCursor }).set("Authorization", auth).expect(200);
      expect(page1.body.items[0].id).not.toBe(page2.body.items[0].id);
      expect(page2.body.nextCursor).toBeNull();
      await api().get("/webhooks/deliveries").query({ status: "LIXO" }).set("Authorization", auth).expect(400);
    });
  });

  describe("compatibilidade: envio legado para o n8n", () => {
    it("N8N_WEBHOOK_URL continua a receber o formato antigo, sem assinatura", async () => {
      const { auth } = await setupAdmin();
      const config = app.get(ConfigService);
      const original = config.get.bind(config);
      jest.spyOn(config, "get").mockImplementation(((key: string) => (key === "N8N_WEBHOOK_URL" ? receiver.url : original(key))) as never);

      const lead = await createLead(auth);
      await waitFor(async () => receiver.received.length === 1, "pedido legado");
      const { headers, body } = receiver.received[0];
      expect(headers["x-opencrm-signature"]).toBeUndefined();
      expect(JSON.parse(body)).toMatchObject({ event: "lead.created", payload: { leadId: lead.body.id, name: "Maria Silva" } });
      expect(await prisma().webhookDelivery.count()).toBe(0); // sem subscrições, nada entra na fila
    });
  });
});
