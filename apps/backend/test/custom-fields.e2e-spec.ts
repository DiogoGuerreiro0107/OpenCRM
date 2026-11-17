import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";

// Campos personalizados genéricos (pacote 0b, docs/plano-fase-0-fundacoes.md).
describe("Campos personalizados (e2e)", () => {
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

  const as = async (role: Role) => bearerFor(app, await createUser(prisma(), role));

  async function defineField(auth: string, body: Record<string, unknown>) {
    const res = await api().post("/custom-fields").set("Authorization", auth).send(body).expect(201);
    return res.body as { id: string };
  }

  const save = (auth: string, entityType: string, entityId: string, values: Array<{ customFieldId: string; value: unknown }>) =>
    api().post("/custom-fields/values").set("Authorization", auth).send({ entityType, entityId, values });

  async function setup() {
    const admin = await as("ADMINISTRADOR");
    const company = await prisma().company.create({ data: { name: "Acme" } });
    const tier = await defineField(admin, { entityType: "COMPANY", fieldLabel: "Escalão", fieldType: "SELECT", options: ["Ouro", "Prata"] });
    const employees = await defineField(admin, { entityType: "COMPANY", fieldLabel: "Funcionários", fieldType: "NUMBER" });
    return { admin, company, tier, employees };
  }

  describe("guardar e ler (comportamento de sempre)", () => {
    it("grava e lê valores de todos os tipos com os identificadores de sempre", async () => {
      const { admin, company, tier, employees } = await setup();
      const since = await defineField(admin, { entityType: "COMPANY", fieldLabel: "Cliente desde", fieldType: "DATE" });
      const vip = await defineField(admin, { entityType: "COMPANY", fieldLabel: "VIP", fieldType: "BOOLEAN" });
      const tags = await defineField(admin, { entityType: "COMPANY", fieldLabel: "Áreas", fieldType: "MULTISELECT", options: ["Impressão", "Software"] });
      const site = await defineField(admin, { entityType: "COMPANY", fieldLabel: "Portal", fieldType: "URL" });

      const res = await save(admin, "COMPANY", company.id, [
        { customFieldId: tier.id, value: "Ouro" },
        { customFieldId: employees.id, value: 25 },
        { customFieldId: since.id, value: "2024-03-01" },
        { customFieldId: vip.id, value: true },
        { customFieldId: tags.id, value: ["Software"] },
        { customFieldId: site.id, value: "https://portal.acme.pt" },
      ]).expect(201);

      const byId = Object.fromEntries(res.body.map((v: { customFieldId: string; value: unknown }) => [v.customFieldId, v.value]));
      expect(byId).toEqual({
        [tier.id]: "Ouro",
        [employees.id]: 25,
        [since.id]: "2024-03-01T00:00:00.000Z",
        [vip.id]: true,
        [tags.id]: ["Software"],
        [site.id]: "https://portal.acme.pt",
      });
      const read = await api().get("/custom-fields/values").query({ entityType: "COMPANY", entityId: company.id }).set("Authorization", admin).expect(200);
      expect(read.body).toHaveLength(6);
    });

    it("tipo de registo desconhecido é recusado (400) em definições e valores", async () => {
      const { admin, company } = await setup();
      await api().get("/custom-fields").query({ entityType: "ORDER" }).set("Authorization", admin).expect(400);
      await api().get("/custom-fields").query({ entityType: "company" }).set("Authorization", admin).expect(400);
      await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "ORDER", fieldLabel: "x", fieldType: "TEXT" }).expect(400);
      await save(admin, "ORDER", company.id, []).expect(400);
    });
  });

  describe("correções de integridade", () => {
    it("um campo de outro tipo de registo é recusado (antes gravava-se)", async () => {
      const { admin, tier } = await setup();
      const deal = await createDeal();
      const res = await save(admin, "DEAL", deal.id, [{ customFieldId: tier.id, value: "Ouro" }]).expect(400);
      expect(res.body.message).toContain("não pertence");
      expect(await prisma().customFieldValue.count()).toBe(0);
    });

    it("registo inexistente dá 404", async () => {
      const { admin, tier } = await setup();
      await save(admin, "COMPANY", "00000000-0000-4000-8000-000000000000", [{ customFieldId: tier.id, value: "Ouro" }]).expect(404);
      expect(await prisma().customFieldValue.count()).toBe(0);
    });

    it("valores inválidos dão 400 com o nome do campo, e um inválido não grava nenhum", async () => {
      const { admin, company, tier, employees } = await setup();
      const bad = await save(admin, "COMPANY", company.id, [
        { customFieldId: tier.id, value: "Ouro" },
        { customFieldId: employees.id, value: "muitos" },
      ]).expect(400);
      expect(bad.body.message).toContain("«Funcionários»");
      expect(await prisma().customFieldValue.count()).toBe(0); // tudo ou nada

      await save(admin, "COMPANY", company.id, [{ customFieldId: tier.id, value: "Bronze" }]).expect(400);
      await save(admin, "COMPANY", company.id, [
        { customFieldId: tier.id, value: "Ouro" },
        { customFieldId: tier.id, value: "Prata" },
      ]).expect(400); // o mesmo campo duas vezes
    });

    it("não se pode esvaziar um campo obrigatório", async () => {
      const { admin, company } = await setup();
      const nif = await defineField(admin, { entityType: "COMPANY", fieldLabel: "Código interno", fieldType: "TEXT", isRequired: true });
      await save(admin, "COMPANY", company.id, [{ customFieldId: nif.id, value: "A-1" }]).expect(201);
      const res = await save(admin, "COMPANY", company.id, [{ customFieldId: nif.id, value: "" }]).expect(400);
      expect(res.body.message).toContain("obrigatório");
    });

    it("mudar o tipo de um campo com valores é recusado; sem valores é permitido", async () => {
      const { admin, company, tier, employees } = await setup();
      await save(admin, "COMPANY", company.id, [{ customFieldId: employees.id, value: 10 }]).expect(201);
      const res = await api().patch(`/custom-fields/${employees.id}`).set("Authorization", admin).send({ fieldType: "TEXT" }).expect(400);
      expect(res.body.message).toContain("1 valor");
      await api().patch(`/custom-fields/${tier.id}`).set("Authorization", admin).send({ fieldType: "TEXT" }).expect(200);
      // mudar só o rótulo continua livre
      await api().patch(`/custom-fields/${employees.id}`).set("Authorization", admin).send({ fieldLabel: "N.º de funcionários" }).expect(200);
    });

    it("mudar as opções não apaga um valor antigo, mas ele já não pode ser escolhido", async () => {
      const { admin, company, tier } = await setup();
      await save(admin, "COMPANY", company.id, [{ customFieldId: tier.id, value: "Prata" }]).expect(201);
      await api().patch(`/custom-fields/${tier.id}`).set("Authorization", admin).send({ options: ["Ouro", "Platina"] }).expect(200);
      const read = await api().get("/custom-fields/values").query({ entityType: "COMPANY", entityId: company.id }).set("Authorization", admin).expect(200);
      expect(read.body[0].value).toBe("Prata");
      await save(admin, "COMPANY", company.id, [{ customFieldId: tier.id, value: "Prata" }]).expect(400);
    });
  });

  describe("permissões por tipo de registo", () => {
    it("quem não pode editar empresas (Técnico) não pode preencher os campos delas; Comercial pode", async () => {
      const { company, tier } = await setup();
      const res = await save(await as("TECNICO"), "COMPANY", company.id, [{ customFieldId: tier.id, value: "Ouro" }]).expect(403);
      expect(res.body.message).toContain("empresas");
      await save(await as("LEITURA_APENAS"), "COMPANY", company.id, [{ customFieldId: tier.id, value: "Ouro" }]).expect(403);
      await save(await as("COMERCIAL"), "COMPANY", company.id, [{ customFieldId: tier.id, value: "Ouro" }]).expect(201);
      await save(await as("FINANCEIRO"), "COMPANY", company.id, [{ customFieldId: tier.id, value: "Prata" }]).expect(201);
    });

    it("contactos seguem a matriz dos contactos (Financeiro não edita contactos)", async () => {
      const admin = await as("ADMINISTRADOR");
      const contact = await prisma().contact.create({ data: { name: "Ana" } });
      const f = await defineField(admin, { entityType: "CONTACT", fieldLabel: "Hobby", fieldType: "TEXT" });
      await save(await as("FINANCEIRO"), "CONTACT", contact.id, [{ customFieldId: f.id, value: "Ténis" }]).expect(403);
      await save(await as("BACKOFFICE"), "CONTACT", contact.id, [{ customFieldId: f.id, value: "Ténis" }]).expect(201);
    });

    it("todos podem LER os valores (as fichas são visíveis a todos)", async () => {
      const { admin, company, tier } = await setup();
      await save(admin, "COMPANY", company.id, [{ customFieldId: tier.id, value: "Ouro" }]).expect(201);
      const res = await api().get("/custom-fields/values").query({ entityType: "COMPANY", entityId: company.id }).set("Authorization", await as("TECNICO")).expect(200);
      expect(res.body).toHaveLength(1);
    });
  });

  describe("módulos desligados", () => {
    it("com o módulo de leads desligado, definições e valores de LEAD dão 404; empresas não são afetadas", async () => {
      const admin = await as("ADMINISTRADOR");
      const lead = await prisma().lead.create({ data: { name: "Lead" } });
      const f = await defineField(admin, { entityType: "LEAD", fieldLabel: "Campanha", fieldType: "TEXT" });

      await api().patch("/modules/leads").set("Authorization", admin).send({ enabled: false }).expect(200);
      await api().get("/custom-fields").query({ entityType: "LEAD" }).set("Authorization", admin).expect(404);
      await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "LEAD", fieldLabel: "y", fieldType: "TEXT" }).expect(404);
      await api().get("/custom-fields/values").query({ entityType: "LEAD", entityId: lead.id }).set("Authorization", admin).expect(404);
      await save(admin, "LEAD", lead.id, [{ customFieldId: f.id, value: "Natal" }]).expect(404);
      await api().get("/custom-fields").query({ entityType: "COMPANY" }).set("Authorization", admin).expect(200);

      await api().patch("/modules/leads").set("Authorization", admin).send({ enabled: true }).expect(200);
      await save(admin, "LEAD", lead.id, [{ customFieldId: f.id, value: "Natal" }]).expect(201);
    });
  });

  describe("apagar um registo apaga os seus valores", () => {
    it("empresa, contacto, lead e negócio", async () => {
      const admin = await as("ADMINISTRADOR");
      const company = await prisma().company.create({ data: { name: "Acme" } });
      const contact = await prisma().contact.create({ data: { name: "Ana" } });
      const lead = await prisma().lead.create({ data: { name: "Lead" } });
      const deal = await createDeal();
      const keep = await prisma().company.create({ data: { name: "Fica" } });

      for (const [type, id] of [["COMPANY", company.id], ["CONTACT", contact.id], ["LEAD", lead.id], ["DEAL", deal.id], ["COMPANY", keep.id]] as const) {
        const f = await prisma().customField.findFirst({ where: { entityType: type } }) ?? (await defineField(admin, { entityType: type, fieldLabel: `Nota ${type}`, fieldType: "TEXT" }));
        await save(admin, type, id, [{ customFieldId: f.id, value: "x" }]).expect(201);
      }
      expect(await prisma().customFieldValue.count()).toBe(5);

      await api().delete(`/companies/${company.id}`).set("Authorization", admin).expect((r) => expect([200, 204]).toContain(r.status));
      await api().delete(`/contacts/${contact.id}`).set("Authorization", admin).expect((r) => expect([200, 204]).toContain(r.status));
      await api().delete(`/leads/${lead.id}`).set("Authorization", admin).expect(204);
      await api().delete(`/deals/${deal.id}`).set("Authorization", admin).expect((r) => expect([200, 204]).toContain(r.status));

      const left = await prisma().customFieldValue.findMany();
      expect(left.map((v) => v.entityId)).toEqual([keep.id]);
    });
  });

  async function createDeal() {
    const pipeline = await prisma().pipeline.create({ data: { name: "Vendas" } });
    const stage = await prisma().stage.create({ data: { name: "Novo", order: 0, pipelineId: pipeline.id } });
    const owner = (await prisma().user.findFirst()) ?? (await createUser(prisma(), "ADMINISTRADOR"));
    return prisma().deal.create({ data: { title: "Negócio", pipelineId: pipeline.id, stageId: stage.id, ownerId: owner.id } });
  }
});
