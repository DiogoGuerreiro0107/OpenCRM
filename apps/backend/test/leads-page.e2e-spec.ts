import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";
import { PermissionsService } from "../src/auth/permissions.service";
import { expectConforms } from "./openapi-conformance";

// Leads por empresa/pessoa: modelo, listagem por cursor, contagens, modo (Fase 1b, docs/plano-fase-1-leads.md).
describe("Leads: modelo e listagem (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    await app.get(PermissionsService).reload();
  });

  afterAll(async () => {
    await app.close();
  });

  const as = async (role: Role) => bearerFor(app, await createUser(prisma(), role));
  const createLead = (auth: string, body: Record<string, unknown>) => api().post("/leads").set("Authorization", auth).send(body);

  describe("tipo e ligação a registos existentes", () => {
    it("sem tipo: com nome de empresa fica COMPANY, sem fica PERSON (modo BOTH, a predefinição)", async () => {
      const auth = await as("COMERCIAL");
      const a = (await createLead(auth, { name: "Ana", companyName: "Acme Lda" }).expect(201)).body;
      const b = (await createLead(auth, { name: "Rui" }).expect(201)).body;
      expect(a.kind).toBe("COMPANY");
      expect(b.kind).toBe("PERSON");
      // as colunas internas não saem na API
      expect(a.searchText).toBeUndefined();
      expect(a.nextActionSort).toBeUndefined();
    });

    it("liga a uma empresa e a um contacto existentes; sem empresa usa a do contacto; ids inexistentes dão 400", async () => {
      const auth = await as("COMERCIAL");
      const company = await prisma().company.create({ data: { name: "Acme" } });
      const contact = await prisma().contact.create({ data: { name: "Ana", companyId: company.id } });

      const byContact = (await createLead(auth, { name: "Ana", kind: "PERSON", contactId: contact.id, jobTitle: "Compras" }).expect(201)).body;
      expect(byContact).toMatchObject({ kind: "PERSON", contactId: contact.id, companyId: company.id, jobTitle: "Compras", contact: { name: "Ana" }, company: { name: "Acme" } });

      const byCompany = (await createLead(auth, { name: "Acme", kind: "COMPANY", companyId: company.id, taxId: "500100200" }).expect(201)).body;
      expect(byCompany).toMatchObject({ kind: "COMPANY", companyId: company.id, taxId: "500100200", contactId: null });

      await createLead(auth, { name: "x", companyId: "00000000-0000-4000-8000-000000000000" }).expect(400);
      await createLead(auth, { name: "x", contactId: "00000000-0000-4000-8000-000000000000" }).expect(400);
      await createLead(auth, { name: "x", kind: "OUTRO" }).expect(400);
    });

    it("apagar a empresa ligada não apaga a lead (fica sem ligação)", async () => {
      const auth = await as("ADMINISTRADOR");
      const company = await prisma().company.create({ data: { name: "Acme" } });
      const lead = (await createLead(auth, { name: "Acme", companyId: company.id }).expect(201)).body;
      await api().delete(`/companies/${company.id}`).set("Authorization", auth).expect((r) => expect([200, 204]).toContain(r.status));
      expect(await prisma().lead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ companyId: null, companyName: null });
    });
  });

  describe("modo do módulo", () => {
    it("só o Administrador muda o modo (auditado); todos o leem", async () => {
      const admin = await as("ADMINISTRADOR");
      const comercial = await as("COMERCIAL");
      expect((await api().get("/leads/settings").set("Authorization", comercial).expect(200)).body).toEqual({ mode: "BOTH" });
      await api().patch("/leads/settings").set("Authorization", comercial).send({ mode: "COMPANY" }).expect(403);
      await api().patch("/leads/settings").set("Authorization", admin).send({ mode: "QUALQUER" }).expect(400);
      expect((await api().patch("/leads/settings").set("Authorization", admin).send({ mode: "COMPANY" }).expect(200)).body).toEqual({ mode: "COMPANY" });
      expect((await api().get("/leads/settings").set("Authorization", comercial).expect(200)).body).toEqual({ mode: "COMPANY" });
      expect(await prisma().auditEvent.findFirstOrThrow({ where: { action: "lead_settings.updated" } })).toMatchObject({ metadata: { mode: "COMPANY" } });
      // mudar o modo não desliga o módulo
      expect(app.get(ModulesService).isEnabled("leads")).toBe(true);
    });

    it("no modo COMPANY: sem tipo cria empresa; pessoa é recusada; leads antigas de pessoa continuam editáveis", async () => {
      const admin = await as("ADMINISTRADOR");
      const old = (await createLead(admin, { name: "Rui" }).expect(201)).body; // PERSON, criada em BOTH
      await api().patch("/leads/settings").set("Authorization", admin).send({ mode: "COMPANY" }).expect(200);

      expect((await createLead(admin, { name: "Sem empresa" }).expect(201)).body.kind).toBe("COMPANY");
      await createLead(admin, { name: "x", kind: "PERSON" }).expect(400);
      await api().patch(`/leads/${old.id}`).set("Authorization", admin).send({ notes: "ainda editável" }).expect(200);
      await api().patch(`/leads/${old.id}`).set("Authorization", admin).send({ kind: "COMPANY" }).expect(200); // para o tipo permitido: sim

      await api().patch("/leads/settings").set("Authorization", admin).send({ mode: "PERSON" }).expect(200);
      await api().patch(`/leads/${old.id}`).set("Authorization", admin).send({ kind: "COMPANY", notes: "x" }).expect(200); // manter o tipo que tem: sim
      const company = (await createLead(admin, { name: "y", kind: "PERSON" }).expect(201)).body;
      await api().patch(`/leads/${company.id}`).set("Authorization", admin).send({ kind: "COMPANY" }).expect(400);
    });

    it("a API pública respeita o modo e devolve kind/tax_id (conforme a especificação)", async () => {
      const admin = await as("ADMINISTRADOR");
      const key = (await api().post("/api-keys").set("Authorization", admin).send({ name: "Loja", scopes: ["leads:write"] }).expect(201)).body.key;
      const post = (idem: string, body: Record<string, unknown>) =>
        api().post("/api/v1/leads").set({ Authorization: `Bearer ${key}`, "Idempotency-Key": idem }).send(body);

      const res = await post("modo-0000001", { name: "Acme", company_name: "Acme Lda", tax_id: "500100200" }).expect(201);
      expect(res.body.data).toMatchObject({ kind: "COMPANY", tax_id: "500100200" });
      expectConforms(res, "POST", "/api/v1/leads");

      await api().patch("/leads/settings").set("Authorization", admin).send({ mode: "COMPANY" }).expect(200);
      const refused = await post("modo-0000002", { name: "x", kind: "PERSON" }).expect(400);
      expectConforms(refused, "POST", "/api/v1/leads");
    });
  });

  describe("listagem por cursor", () => {
    async function seed() {
      const owner = await createUser(prisma(), "FINANCEIRO", "Carla");
      const other = await createUser(prisma(), "BACKOFFICE", "Bruno");
      const base = Date.UTC(2026, 10, 20, 9);
      const rows = [];
      for (let i = 0; i < 25; i++) {
        rows.push({
          name: `Lead ${String(i).padStart(2, "0")}`,
          companyName: i % 2 === 0 ? `Empresa ${i}` : null,
          kind: i % 2 === 0 ? ("COMPANY" as const) : ("PERSON" as const),
          email: i === 7 ? "maria.silva@exemplo.pt" : `lead${i}@exemplo.pt`,
          status: i < 15 ? ("NOVO" as const) : ("CONTACTADO" as const),
          responsavelId: i % 3 === 0 ? other.id : owner.id,
          // 5 sem próxima ação (vão para o fim), e várias com a MESMA data (desempate pelo id)
          nextActionAt: i >= 20 ? null : new Date(base + Math.floor(i / 4) * 3600_000),
        });
      }
      await prisma().lead.createMany({ data: rows });
      return { owner, other };
    }

    async function walk(auth: string, query: Record<string, string | number>) {
      const all: Array<{ id: string; name: string; nextActionAt: string | null }> = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await api().get("/leads/page").query({ ...query, ...(cursor ? { cursor } : {}) }).set("Authorization", auth).expect(200);
        all.push(...res.body.items);
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor && pages < 50);
      return { all, pages };
    }

    it("percorre tudo sem repetir nem saltar, por próxima ação (sem data no fim), com desempate estável", async () => {
      const auth = await as("COMERCIAL");
      await seed();
      const { all, pages } = await walk(auth, { limit: 4 });
      expect(pages).toBe(7);
      expect(all).toHaveLength(25);
      expect(new Set(all.map((l) => l.id)).size).toBe(25);
      const withDate = all.filter((l) => l.nextActionAt);
      expect(all.slice(0, 20).every((l) => l.nextActionAt)).toBe(true); // datas primeiro
      expect(all.slice(20).every((l) => l.nextActionAt === null)).toBe(true); // sem data no fim
      const dates = withDate.map((l) => new Date(l.nextActionAt!).getTime());
      expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    });

    it("filtros por estado, tipo, responsável e pesquisa (sem distinguir maiúsculas)", async () => {
      const auth = await as("COMERCIAL");
      const { owner } = await seed();
      expect((await walk(auth, { status: "CONTACTADO" })).all).toHaveLength(10);
      expect((await walk(auth, { kind: "COMPANY" })).all).toHaveLength(13);
      expect((await walk(auth, { responsavelId: owner.id, status: "NOVO" })).all.length).toBe(10);
      const found = (await walk(auth, { search: "SILVA" })).all;
      expect(found.map((l) => l.name)).toEqual(["Lead 07"]);
      expect((await walk(auth, { search: "empresa 1" })).all.map((l) => l.name).sort()).toEqual(["Lead 10", "Lead 12", "Lead 14", "Lead 16", "Lead 18"]);
    });

    it("a pesquisa acompanha alterações (coluna mantida pelo trigger)", async () => {
      const auth = await as("COMERCIAL");
      const lead = (await createLead(auth, { name: "Antigo Nome" }).expect(201)).body;
      expect((await walk(auth, { search: "antigo" })).all).toHaveLength(1);
      await api().patch(`/leads/${lead.id}`).set("Authorization", auth).send({ name: "Novo Nome", email: "novo@exemplo.pt" }).expect(200);
      expect((await walk(auth, { search: "antigo" })).all).toHaveLength(0);
      expect((await walk(auth, { search: "NOVO@EXEMPLO" })).all).toHaveLength(1);
      // mudar a próxima ação muda a ordem
      await api().patch(`/leads/${lead.id}`).set("Authorization", auth).send({ nextActionAt: "2020-01-01T00:00:00.000Z" }).expect(200);
      await createLead(auth, { name: "Outra", nextActionAt: "2025-01-01T00:00:00.000Z" }).expect(201);
      expect((await walk(auth, {})).all.map((l) => l.name)).toEqual(["Novo Nome", "Outra"]);
    });

    it("contagens por separador com os mesmos filtros (exceto o estado)", async () => {
      const auth = await as("COMERCIAL");
      const { owner } = await seed();
      expect((await api().get("/leads/counts").set("Authorization", auth).expect(200)).body).toEqual({ total: 25, byStatus: { NOVO: 15, CONTACTADO: 10 } });
      const mine = (await api().get("/leads/counts").query({ responsavelId: owner.id }).set("Authorization", auth).expect(200)).body;
      expect(mine.total).toBe((await walk(auth, { responsavelId: owner.id })).all.length);
      const ignoresStatus = (await api().get("/leads/counts").query({ status: "NOVO" }).set("Authorization", auth).expect(200)).body;
      expect(ignoresStatus.total).toBe(25);
    });

    it("parâmetros inválidos dão 400; cursor inválido devolve a primeira página; a lista antiga sem paginação já não existe", async () => {
      const auth = await as("COMERCIAL");
      await seed();
      await api().get("/leads/page").query({ limit: 0 }).set("Authorization", auth).expect(400);
      await api().get("/leads/page").query({ limit: 101 }).set("Authorization", auth).expect(400);
      await api().get("/leads/page").query({ kind: "OUTRO" }).set("Authorization", auth).expect(400);
      const first = await api().get("/leads/page").query({ cursor: "lixo", limit: 3 }).set("Authorization", auth).expect(200);
      expect(first.body.items).toHaveLength(3);
      // removida no 1c: a página usa /leads/page (uma lista sem limite não escala)
      await api().get("/leads").set("Authorization", auth).expect(404);
    });

    it("com o módulo de leads desligado, as rotas novas dão 404", async () => {
      const admin = await as("ADMINISTRADOR");
      await api().patch("/modules/leads").set("Authorization", admin).send({ enabled: false }).expect(200);
      await api().get("/leads/page").set("Authorization", admin).expect(404);
      await api().get("/leads/counts").set("Authorization", admin).expect(404);
      await api().get("/leads/settings").set("Authorization", admin).expect(404);
    });
  });
});
