import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { foldSearch } from "../src/common/search-text";

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

  it("empresas: `limit` corta os resultados por ordem alfabética; sem `limit`, página de 50 (nunca a tabela toda)", async () => {
    const limited = (await get("/companies", { limit: 5 }).expect(200)).body.items as Array<{ name: string }>;
    expect(limited.map((c) => c.name)).toEqual(["Acme Lda", "Beta SA", "Empresa 01", "Empresa 02", "Empresa 03"]);

    const page = (await get("/companies").expect(200)).body;
    expect(page.items).toHaveLength(32);
    expect(page.nextCursor).toBeNull();
  });

  it("empresas: pesquisa por NIF, email ou nome, com limite", async () => {
    expect((await get("/companies", { search: "501 234", limit: 20 }).expect(200)).body.items.map((c: { name: string }) => c.name)).toEqual(["Acme Lda"]);
    expect((await get("/companies", { search: "@beta", limit: 20 }).expect(200)).body.items.map((c: { name: string }) => c.name)).toEqual(["Beta SA"]);
    expect((await get("/companies", { search: "empresa", limit: 20 }).expect(200)).body.items).toHaveLength(20);
  });

  it("contactos: pesquisa, filtro por empresa e limite", async () => {
    const acme = await prismaOf(app).company.findFirstOrThrow({ where: { name: "Acme Lda" } });
    const anas = (await get("/contacts", { search: "ana", limit: 20 }).expect(200)).body.items as Array<{ name: string; company: { name: string } }>;
    expect(anas.map((c) => c.name)).toEqual(["Ana Acme", "Ana Beta"]);
    expect(anas[0].company.name).toBe("Acme Lda"); // o seletor mostra a empresa de cada contacto

    const ofAcme = (await get("/contacts", { companyId: acme.id, limit: 20 }).expect(200)).body.items as Array<{ name: string }>;
    expect(ofAcme.map((c) => c.name)).toEqual(["Ana Acme", "Bruno Acme"]);

    expect((await get("/contacts", { search: "912000", limit: 20 }).expect(200)).body.items.map((c: { name: string }) => c.name)).toEqual(["Bruno Acme"]);
    expect((await get("/contacts", { limit: 1 }).expect(200)).body.items).toHaveLength(1);
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
  describe("pesquisa sem acentos (unaccent)", () => {
    beforeEach(async () => {
      const prisma = prismaOf(app);
      const sj = await prisma.company.create({ data: { name: "Gráfica São João", legalName: "Artes Gráficas Ç Lda" } });
      await prisma.contact.create({ data: { name: "João Gonçalves", email: "JOAO@Exemplo.pt", companyId: sj.id } });
      await prisma.lead.create({ data: { name: "Inês Conceição", companyName: "Pão Quente" } });
    });

    it("empresas e contactos: sem acentos, com acentos e em maiúsculas dão o mesmo", async () => {
      for (const term of ["sao joao", "São João", "GRAFICA", "graficas c"]) {
        const names = (await get("/companies", { search: term, limit: 20 }).expect(200)).body.items.map((c: { name: string }) => c.name);
        expect({ term, names }).toEqual({ term, names: ["Gráfica São João"] });
      }
      for (const term of ["joao goncalves", "JOÃO", "joao@exemplo"]) {
        const names = (await get("/contacts", { search: term, limit: 20 }).expect(200)).body.items.map((c: { name: string }) => c.name);
        expect({ term, names }).toEqual({ term, names: ["João Gonçalves"] });
      }
    });

    it("leads (página): também sem acentos", async () => {
      for (const term of ["ines conceicao", "pao quente", "CONCEIÇÃO"]) {
        const items = (await get("/leads/page", { search: term }).expect(200)).body.items.map((l: { name: string }) => l.name);
        expect({ term, items }).toEqual({ term, items: ["Inês Conceição"] });
      }
    });

    it("a coluna interna de pesquisa não sai nas respostas (listas, fichas e includes)", async () => {
      const prisma = prismaOf(app);
      const company = await prisma.company.findFirstOrThrow({ where: { name: "Gráfica São João" } });
      const contact = await prisma.contact.findFirstOrThrow({ where: { name: "João Gonçalves" } });
      const bodies = [
        (await get("/companies").expect(200)).text,
        (await get(`/companies/${company.id}`).expect(200)).text,
        (await get("/contacts").expect(200)).text,
        (await get(`/contacts/${contact.id}`).expect(200)).text, // inclui a empresa
        (await get("/leads/page").expect(200)).text,
        (await get("/contacts", { companyId: company.id }).expect(200)).text, // inclui a empresa
      ];
      for (const body of bodies) expect(body).not.toContain("searchText");
    });

    it("a normalização do termo (TypeScript) é igual à das colunas (Postgres) em todas as letras latinas U+00C0–U+017F", async () => {
      const chars: string[] = [];
      for (let c = 0xc0; c <= 0x17f; c++) if (c !== 0xd7 && c !== 0xf7) chars.push(String.fromCodePoint(c));
      const rows = await prismaOf(app).$queryRaw<Array<{ c: string; f: string }>>`SELECT c, lower(unaccent(c)) AS f FROM unnest(${chars}::text[]) AS c`;
      const different = rows.filter((r) => r.f !== foldSearch(r.c)).map((r) => `${r.c}: postgres=${r.f} ts=${foldSearch(r.c)}`);
      expect(different).toEqual([]);
      expect(rows).toHaveLength(chars.length);
    });
  });
});
