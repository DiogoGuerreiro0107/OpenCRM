import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

/** Pesquisa usada pelos seletores de empresa/contacto (docs/plano-seletores-com-pesquisa.md). */
describe("Pesquisa de empresas e contactos para os seletores (e2e)", () => {
  let app: INestApplication;
  let auth: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    const prisma = prismaOf(app);
    await resetDatabase(prisma);
    auth = await bearerFor(app, await createUser(prisma, "COMERCIAL"));

    const acme = await prisma.company.create({ data: { name: "Acme Lda", taxId: "PT 501 234 567" } });
    const beta = await prisma.company.create({ data: { name: "Beta SA", email: "geral@beta.pt" } });
    for (let i = 1; i <= 30; i++) await prisma.company.create({ data: { name: `Empresa ${String(i).padStart(2, "0")}` } });
    await prisma.contact.create({ data: { name: "Ana Acme", email: "ana@acme.pt", companyId: acme.id } });
    await prisma.contact.create({ data: { name: "Bruno Acme", mobilePhone: "912000111", companyId: acme.id } });
    await prisma.contact.create({ data: { name: "Ana Beta", companyId: beta.id } });
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, query: Record<string, unknown> = {}) =>
    request(app.getHttpServer()).get(path).query(query).set("Authorization", auth);

  it("empresas: `limit` corta os resultados por ordem alfabética; sem `limit` devolve todas (como antes)", async () => {
    const limited = (await get("/companies", { limit: 5 }).expect(200)).body as Array<{ name: string }>;
    expect(limited.map((c) => c.name)).toEqual(["Acme Lda", "Beta SA", "Empresa 01", "Empresa 02", "Empresa 03"]);

    const all = (await get("/companies").expect(200)).body;
    expect(all).toHaveLength(32);
  });

  it("empresas: pesquisa por NIF, email ou nome, com limite", async () => {
    expect((await get("/companies", { search: "501 234", limit: 20 }).expect(200)).body.map((c: { name: string }) => c.name)).toEqual(["Acme Lda"]);
    expect((await get("/companies", { search: "@beta", limit: 20 }).expect(200)).body.map((c: { name: string }) => c.name)).toEqual(["Beta SA"]);
    expect((await get("/companies", { search: "empresa", limit: 20 }).expect(200)).body).toHaveLength(20);
  });

  it("contactos: pesquisa, filtro por empresa e limite", async () => {
    const acme = await prismaOf(app).company.findFirstOrThrow({ where: { name: "Acme Lda" } });
    const anas = (await get("/contacts", { search: "ana", limit: 20 }).expect(200)).body as Array<{ name: string; company: { name: string } }>;
    expect(anas.map((c) => c.name)).toEqual(["Ana Acme", "Ana Beta"]);
    expect(anas[0].company.name).toBe("Acme Lda"); // o seletor mostra a empresa de cada contacto

    const ofAcme = (await get("/contacts", { companyId: acme.id, limit: 20 }).expect(200)).body as Array<{ name: string }>;
    expect(ofAcme.map((c) => c.name)).toEqual(["Ana Acme", "Bruno Acme"]);

    expect((await get("/contacts", { search: "912000", limit: 20 }).expect(200)).body.map((c: { name: string }) => c.name)).toEqual(["Bruno Acme"]);
    expect((await get("/contacts", { limit: 1 }).expect(200)).body).toHaveLength(1);
  });

  it("limites fora do intervalo dão 400", async () => {
    await get("/companies", { limit: 0 }).expect(400);
    await get("/companies", { limit: 101 }).expect(400);
    await get("/contacts", { limit: "muitos" }).expect(400);
  });

  describe("limpar ao editar: null apaga a ligação (o que os seletores enviam ao limpar)", () => {
    const patch = (path: string, body: Record<string, unknown>) =>
      request(app.getHttpServer()).patch(path).set("Authorization", auth).send(body);

    it("empresa: responsável e email apagados ficam null (email vazio já não é recusado como inválido)", async () => {
      const prisma = prismaOf(app);
      const owner = await prisma.user.findFirstOrThrow();
      const company = await prisma.company.create({ data: { name: "Com dono", email: "x@y.pt", ownerId: owner.id } });
      const res = await patch(`/companies/${company.id}`, { name: "Com dono", email: null, ownerId: null, website: null }).expect(200);
      expect(res.body).toMatchObject({ email: null, ownerId: null, website: null });
    });

    it("contacto, negócio e tarefa: empresa/contacto a null desligam", async () => {
      const prisma = prismaOf(app);
      const company = await prisma.company.findFirstOrThrow({ where: { name: "Acme Lda" } });
      const contact = await prisma.contact.findFirstOrThrow({ where: { name: "Ana Acme" } });
      expect((await patch(`/contacts/${contact.id}`, { companyId: null }).expect(200)).body.companyId).toBeNull();

      const pipeline = (await request(app.getHttpServer()).post("/pipelines").set("Authorization", await bearerFor(app, await createUser(prisma, "ADMINISTRADOR"))).send({ name: "Vendas" }).expect(201)).body;
      const deal = (await request(app.getHttpServer()).post("/deals").set("Authorization", auth).send({ title: "N", pipelineId: pipeline.id, stageId: pipeline.stages[0].id, companyId: company.id, contactId: contact.id }).expect(201)).body;
      const clearedDeal = (await patch(`/deals/${deal.id}`, { companyId: null, contactId: null }).expect(200)).body;
      expect(clearedDeal).toMatchObject({ companyId: null, contactId: null });

      const task = (await request(app.getHttpServer()).post("/tasks").set("Authorization", auth).send({ title: "T", companyId: company.id, contactId: contact.id }).expect(201)).body;
      const clearedTask = (await patch(`/tasks/${task.id}`, { companyId: null, contactId: null }).expect(200)).body;
      expect(clearedTask).toMatchObject({ companyId: null, contactId: null });
    });
  });
});
