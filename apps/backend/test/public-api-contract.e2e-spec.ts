import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";
import { OPENAPI_SPEC } from "../src/public-api/openapi";
import { expectConforms } from "./openapi-conformance";

// Contrato da API pública (pacote E0e): as respostas reais cumprem a especificação OpenAPI, e os ids externos
// impedem duplicados quando uma integração volta a enviar o mesmo objeto.
describe("Contrato da API pública: OpenAPI e ids externos (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
  });

  afterAll(async () => {
    await app.close();
  });

  async function setup(scopes = ["companies:read", "contacts:read", "leads:write"], rateLimitPerMinute = 120) {
    const admin = await createUser(prisma(), "ADMINISTRADOR", "Ana Admin");
    const auth = await bearerFor(app, admin);
    const res = await api().post("/api-keys").set("Authorization", auth).send({ name: "Loja online", scopes, rateLimitPerMinute }).expect(201);
    return { admin, auth, key: res.body.key as string, keyId: res.body.id as string };
  }

  const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
  const postLead = (key: string, idem: string, body: Record<string, unknown>) =>
    api().post("/api/v1/leads").set({ ...bearer(key), "Idempotency-Key": idem }).send(body);

  describe("respostas reais cumprem a especificação", () => {
    it("ping, openapi.json e erros de autenticação", async () => {
      const { key } = await setup();
      expectConforms(await api().get("/api/v1/ping").set(bearer(key)), "GET", "/api/v1/ping");
      expectConforms(await api().get("/api/v1/ping"), "GET", "/api/v1/ping"); // 401
      const spec = await api().get("/api/v1/openapi.json").set(bearer(key)).expect(200);
      expectConforms(spec, "GET", "/api/v1/openapi.json");
    });

    it("empresas: lista (com dados de todos os tipos), uma, 404, 400 e 403", async () => {
      const { key } = await setup();
      const restricted = await setupRestricted(["contacts:read"]);
      await prisma().company.create({
        data: {
          name: "Acme",
          legalName: "Acme Lda",
          taxId: "500100200",
          website: "https://acme.pt",
          phone: "210000000",
          email: "geral@acme.pt",
          address: "Rua A",
          postalCode: "1000-001",
          city: "Lisboa",
          country: "Portugal",
          status: "ATIVO",
          source: "SITE",
        },
      });
      const minimal = await prisma().company.create({ data: { name: "Mínima" } }); // campos opcionais a null

      expectConforms(await api().get("/api/v1/companies").set(bearer(key)).expect(200), "GET", "/api/v1/companies");
      expectConforms(await api().get("/api/v1/companies").query({ limit: 1 }).set(bearer(key)).expect(200), "GET", "/api/v1/companies");
      expectConforms(await api().get(`/api/v1/companies/${minimal.id}`).set(bearer(key)).expect(200), "GET", "/api/v1/companies/{id}");
      expectConforms(await api().get("/api/v1/companies/nao-existe").set(bearer(key)).expect(404), "GET", "/api/v1/companies/{id}");
      expectConforms(await api().get("/api/v1/companies").query({ limit: 0 }).set(bearer(key)).expect(400), "GET", "/api/v1/companies");
      expectConforms(await api().get("/api/v1/companies").set(bearer(restricted)).expect(403), "GET", "/api/v1/companies");
    });

    it("contactos: lista, um e 404", async () => {
      const { key } = await setup();
      const company = await prisma().company.create({ data: { name: "Acme" } });
      const full = await prisma().contact.create({
        data: {
          name: "Ana",
          email: "ana@acme.pt",
          phone: "210000001",
          mobilePhone: "912000000",
          jobTitle: "Diretora",
          department: "Compras",
          preferredChannel: "EMAIL",
          isDecisionMaker: true,
          marketingConsent: true,
          companyId: company.id,
        },
      });
      await prisma().contact.create({ data: { name: "Sem nada" } });
      expectConforms(await api().get("/api/v1/contacts").set(bearer(key)).expect(200), "GET", "/api/v1/contacts");
      expectConforms(await api().get(`/api/v1/contacts/${full.id}`).set(bearer(key)).expect(200), "GET", "/api/v1/contacts/{id}");
      expectConforms(await api().get("/api/v1/contacts/nao-existe").set(bearer(key)).expect(404), "GET", "/api/v1/contacts/{id}");
    });

    it("leads: 201 (completo e mínimo), repetição, 400, 409, 422, 404 e 429", async () => {
      const { auth, key } = await setup();
      expectConforms(
        await postLead(key, "contrato-0001", {
          name: "Maria",
          company_name: "Exemplo Lda",
          phone: "912345678",
          email: "maria@exemplo.pt",
          source: "Site",
          interest: "IMPRESSAO",
          notes: "Quer orçamento",
          external_id: "loja-42",
        }).expect(201),
        "POST",
        "/api/v1/leads",
      );
      const minimal = await postLead(key, "contrato-0002", { name: "Rui" }).expect(201);
      expectConforms(minimal, "POST", "/api/v1/leads");
      expect(minimal.body.data.external_id).toBeNull();
      expectConforms(await postLead(key, "contrato-0002", { name: "Rui" }).expect(201), "POST", "/api/v1/leads"); // repetição
      expectConforms(await postLead(key, "contrato-0003", { email: "lixo" }).expect(400), "POST", "/api/v1/leads");
      expectConforms(await api().post("/api/v1/leads").set(bearer(key)).send({ name: "x" }).expect(400), "POST", "/api/v1/leads");
      expectConforms(await postLead(key, "contrato-0002", { name: "Outro" }).expect(422), "POST", "/api/v1/leads");
      expectConforms(await postLead(key, "contrato-0004", { name: "Maria", external_id: "loja-42" }).expect(409), "POST", "/api/v1/leads");

      await api().patch("/modules/leads").set("Authorization", auth).send({ enabled: false }).expect(200);
      expectConforms(await postLead(key, "contrato-0005", { name: "x" }).expect(404), "POST", "/api/v1/leads");
    });

    it("429 com Retry-After cumpre a especificação", async () => {
      const { key } = await setup(["companies:read"], 1);
      await api().get("/api/v1/ping").set(bearer(key)).expect(200);
      expectConforms(await api().get("/api/v1/ping").set(bearer(key)).expect(429), "GET", "/api/v1/ping");
    });

    it("a especificação servida é exatamente a do código, com qualquer chave; sem chave dá 401", async () => {
      const { key } = await setup(["leads:write"]);
      const res = await api().get("/api/v1/openapi.json").set(bearer(key)).expect(200);
      expect(res.body).toEqual(JSON.parse(JSON.stringify(OPENAPI_SPEC)));
      await api().get("/api/v1/openapi.json").expect(401);
    });

    it("o Administrador descarrega a especificação pela gestão de chaves; os outros papéis não", async () => {
      const { auth } = await setup();
      const res = await api().get("/api-keys/openapi.json").set("Authorization", auth).expect(200);
      expect(res.body.openapi).toBe("3.1.0");
      const comercial = await bearerFor(app, await createUser(prisma(), "COMERCIAL"));
      await api().get("/api-keys/openapi.json").set("Authorization", comercial).expect(403);
      await api().get("/api-keys/openapi.json").expect(401);
    });
  });

  async function setupRestricted(scopes: string[]) {
    const admin = await prisma().user.findFirstOrThrow({ where: { role: "ADMINISTRADOR" } });
    const res = await api().post("/api-keys").set("Authorization", await bearerFor(app, admin)).send({ name: "Restrita", scopes }).expect(201);
    return res.body.key as string;
  }

  describe("ids externos (external_id)", () => {
    it("a mesma chave a repetir o external_id (com outro Idempotency-Key) dá 409 com o lead existente e não cria nada", async () => {
      const { key } = await setup();
      const first = await postLead(key, "ext-000001", { name: "Maria", external_id: "pedido-1001" }).expect(201);
      expect(first.body.data.external_id).toBe("pedido-1001");

      const again = await postLead(key, "ext-000002", { name: "Maria (reenviado)", external_id: "pedido-1001" }).expect(409);
      expect(again.body.error).toMatchObject({ code: "conflict", details: { existing_id: first.body.data.id } });
      expect(await prisma().lead.count()).toBe(1);
      expect(await prisma().workItem.count()).toBe(1);
    });

    it("outra chave pode usar o mesmo external_id (o espaço de ids é de cada integração)", async () => {
      const { key, auth } = await setup();
      const other = (await api().post("/api-keys").set("Authorization", auth).send({ name: "Outra loja", scopes: ["leads:write"] }).expect(201)).body.key;
      await postLead(key, "ext-000003", { name: "A", external_id: "pedido-1" }).expect(201);
      await postLead(other, "ext-000004", { name: "B", external_id: "pedido-1" }).expect(201);
      expect(await prisma().lead.count()).toBe(2);
      expect(await prisma().externalLink.count()).toBe(2);
    });

    it("a ligação fica guardada com o provider da chave e desaparece ao apagar o lead na interface", async () => {
      const { key, keyId, auth } = await setup();
      const created = await postLead(key, "ext-000005", { name: "Maria", external_id: "pedido-77" }).expect(201);
      expect(await prisma().externalLink.findFirstOrThrow()).toMatchObject({
        provider: `api_key:${keyId}`,
        entityType: "lead",
        entityId: created.body.data.id,
        externalId: "pedido-77",
      });

      await api().delete(`/leads/${created.body.data.id}`).set("Authorization", auth).expect(204);
      expect(await prisma().externalLink.count()).toBe(0);
      // e o external_id pode voltar a ser usado
      await postLead(key, "ext-000006", { name: "Maria de novo", external_id: "pedido-77" }).expect(201);
    });

    it("se a criação do lead falhar, o external_id fica livre para a repetição", async () => {
      const { key } = await setup();
      const leads = app.get((await import("../src/leads/leads.service")).LeadsService);
      const spy = jest.spyOn(leads, "create").mockRejectedValueOnce(new Error("falha simulada"));
      await postLead(key, "ext-000007", { name: "Maria", external_id: "pedido-9" }).expect(500);
      expect(await prisma().externalLink.count()).toBe(0);
      spy.mockRestore();
      await postLead(key, "ext-000008", { name: "Maria", external_id: "pedido-9" }).expect(201);
    });

    it("pedidos simultâneos com o mesmo external_id criam no máximo um lead", async () => {
      const { key } = await setup();
      const results = await Promise.all(
        Array.from({ length: 4 }, (_, i) => postLead(key, `ext-simult-${i}`, { name: "Maria", external_id: "pedido-simultaneo" })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await prisma().lead.count()).toBe(1);
    });

    it("external_id vazio ou demasiado longo dá 400", async () => {
      const { key } = await setup();
      await postLead(key, "ext-000009", { name: "x", external_id: "" }).expect(400);
      await postLead(key, "ext-000010", { name: "x", external_id: "a".repeat(201) }).expect(400);
      expect(await prisma().lead.count()).toBe(0);
    });
  });
});
