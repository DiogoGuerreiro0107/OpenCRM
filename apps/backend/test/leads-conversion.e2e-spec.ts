import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

describe("Conversão de lead (e2e)", () => {
  let app: INestApplication;
  let comercial: string;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    const prisma = prismaOf(app);
    await resetDatabase(prisma);
    admin = await bearerFor(app, await createUser(prisma, "ADMINISTRADOR"));
    comercial = await bearerFor(app, await createUser(prisma, "COMERCIAL"));
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function createLead(body: Record<string, unknown> = {}) {
    const res = await api()
      .post("/leads")
      .set("Authorization", comercial)
      .send({ name: "Ana Teste", companyName: "Empresa Teste Lda", email: "ana@teste.pt", phone: "912345678", ...body })
      .expect(201);
    return res.body as { id: string };
  }

  async function createPipeline() {
    const res = await api().post("/pipelines").set("Authorization", admin).send({ name: "Vendas" }).expect(201);
    return res.body as { id: string; stages: Array<{ id: string; type: string }> };
  }

  it("sem nenhum funil configurado, recusa a conversão e não cria nada", async () => {
    const lead = await createLead();
    await api().post(`/leads/${lead.id}/convert`).set("Authorization", comercial).expect(400);

    const prisma = prismaOf(app);
    expect(await prisma.company.count()).toBe(0);
    expect(await prisma.contact.count()).toBe(0);
    expect(await prisma.deal.count()).toBe(0);
  });

  it("converte: cria empresa + contacto + negócio na primeira fase aberta e marca o lead como convertido", async () => {
    const pipeline = await createPipeline();
    const firstOpen = pipeline.stages.find((s) => s.type === "OPEN")!;
    const lead = await createLead();

    const res = await api().post(`/leads/${lead.id}/convert`).set("Authorization", comercial).expect(201);

    expect(res.body.company).toMatchObject({ name: "Empresa Teste Lda" });
    expect(res.body.contact).toMatchObject({ name: "Ana Teste", email: "ana@teste.pt", companyId: res.body.company.id });
    expect(res.body.deal).toMatchObject({ pipelineId: pipeline.id, stageId: firstOpen.id, contactId: res.body.contact.id });
    expect(res.body.lead).toMatchObject({ status: "CONVERTIDO", convertedDealId: res.body.deal.id });

    // ficou tudo mesmo gravado, e a origem ficou registada na timeline do contacto, da empresa e do lead
    const prisma = prismaOf(app);
    expect(await prisma.company.count()).toBe(1);
    expect(await prisma.contact.count()).toBe(1);
    expect(await prisma.deal.count()).toBe(1);
    const events = await prisma.timelineEvent.findMany({ where: { type: "SYSTEM" } });
    expect(events.map((e) => e.entityType).sort()).toEqual(["COMPANY", "CONTACT", "LEAD"]);
  });

  it("converter duas vezes o mesmo lead é recusado e não duplica registos", async () => {
    await createPipeline();
    const lead = await createLead();
    await api().post(`/leads/${lead.id}/convert`).set("Authorization", comercial).expect(201);
    await api().post(`/leads/${lead.id}/convert`).set("Authorization", comercial).expect(400);

    const prisma = prismaOf(app);
    expect(await prisma.company.count()).toBe(1);
    expect(await prisma.contact.count()).toBe(1);
    expect(await prisma.deal.count()).toBe(1);
  });

  it("lead sem nome de empresa converte só em contacto + negócio", async () => {
    await createPipeline();
    const lead = await createLead({ companyName: undefined });
    const res = await api().post(`/leads/${lead.id}/convert`).set("Authorization", comercial).expect(201);

    expect(res.body.company).toBeNull();
    expect(await prismaOf(app).company.count()).toBe(0);
    expect(res.body.deal.title).toContain("Ana Teste");
  });

  it("um lead convertido continua a poder ser editado (regressão: botão Guardar bloqueado)", async () => {
    await createPipeline();
    const lead = await createLead();
    await api().post(`/leads/${lead.id}/convert`).set("Authorization", comercial).expect(201);

    const res = await api()
      .patch(`/leads/${lead.id}`)
      .set("Authorization", comercial)
      .send({ notes: "nota depois de convertido" })
      .expect(200);
    expect(res.body.notes).toBe("nota depois de convertido");
  });
  describe("conversão por tipo: ligados, duplicados ou criados (1c)", () => {
    const convert = (id: string) => api().post(`/leads/${id}/convert`).set("Authorization", comercial);
    const lead = async (body: Record<string, unknown>) =>
      (await api().post("/leads").set("Authorization", comercial).send(body).expect(201)).body as { id: string };

    beforeEach(async () => {
      await createPipeline();
    });

    it("lead de empresa com contacto principal: cria a empresa (NIF, telefone, email) e o contacto ligado a ela", async () => {
      const l = await lead({ kind: "COMPANY", companyName: "Acme Lda", taxId: "PT 501 234 567", name: "Ana Acme", jobTitle: "Compras", phone: "211234567", email: "geral@acme.pt" });
      const res = await convert(l.id).expect(201);

      expect(res.body.outcome).toEqual({ company: "CREATED", contact: "CREATED" });
      expect(res.body.company).toMatchObject({ name: "Acme Lda", taxId: "PT 501 234 567", phone: "211234567", email: "geral@acme.pt" });
      expect(res.body.contact).toMatchObject({ name: "Ana Acme", jobTitle: "Compras", companyId: res.body.company.id });
      expect(res.body.deal.title).toBe("Oportunidade — Acme Lda");
      // a lead fica ligada aos registos usados
      expect(res.body.lead).toMatchObject({ companyId: res.body.company.id, contactId: res.body.contact.id, company: { name: "Acme Lda" } });
      expect(res.body.lead.searchText).toBeUndefined();
    });

    it("lead de empresa sem contacto principal (nome = empresa): só empresa, sem contacto", async () => {
      const l = await lead({ kind: "COMPANY", companyName: "Só Empresa SA", name: "só empresa sa " });
      const res = await convert(l.id).expect(201);

      expect(res.body.contact).toBeNull();
      expect(res.body.outcome).toEqual({ company: "CREATED", contact: null });
      expect(res.body.deal).toMatchObject({ companyId: res.body.company.id, contactId: null });
      const prisma = prismaOf(app);
      expect(await prisma.contact.count()).toBe(0);
      const events = await prisma.timelineEvent.findMany({ where: { type: "SYSTEM" } });
      expect(events.map((e) => e.entityType).sort()).toEqual(["COMPANY", "LEAD"]);
    });

    it("empresa com o mesmo NIF (escrito de outra forma): liga em vez de criar, e não a altera", async () => {
      const prisma = prismaOf(app);
      const existing = await prisma.company.create({ data: { name: "Acme (nome antigo)", taxId: "PT501234567" } });
      const l = await lead({ kind: "COMPANY", companyName: "Acme Lda", taxId: "501 234 567", name: "Rui" });
      const res = await convert(l.id).expect(201);

      expect(res.body.outcome.company).toBe("MATCHED");
      expect(res.body.company.id).toBe(existing.id);
      expect(await prisma.company.count()).toBe(1);
      expect((await prisma.company.findUniqueOrThrow({ where: { id: existing.id } })).name).toBe("Acme (nome antigo)");
      expect(res.body.contact.companyId).toBe(existing.id);
      // a timeline da lead diz o que aconteceu a cada registo
      const [event] = await prisma.timelineEvent.findMany({ where: { entityType: "LEAD", entityId: l.id, type: "SYSTEM" } });
      expect(event.description).toBe(`Convertido: empresa "Acme (nome antigo)" (já existia, mesmo NIF); contacto "Rui" (novo).`);
    });

    it("contacto com o mesmo email (outras maiúsculas): liga; sem empresa, fica com a da conversão", async () => {
      const prisma = prismaOf(app);
      const existing = await prisma.contact.create({ data: { name: "Ana (já existia)", email: "Ana@Teste.PT" } });
      const l = await lead({ kind: "PERSON", name: "Ana", email: "ana@teste.pt", companyName: "Nova Lda" });
      const res = await convert(l.id).expect(201);

      expect(res.body.outcome).toEqual({ company: "CREATED", contact: "MATCHED" });
      expect(res.body.contact.id).toBe(existing.id);
      expect(await prisma.contact.count()).toBe(1);
      const after = await prisma.contact.findUniqueOrThrow({ where: { id: existing.id } });
      expect(after).toMatchObject({ name: "Ana (já existia)", companyId: res.body.company.id });
    });

    it("contacto encontrado que já tem outra empresa: liga, mas não lhe muda a empresa", async () => {
      const prisma = prismaOf(app);
      const other = await prisma.company.create({ data: { name: "Outra" } });
      const existing = await prisma.contact.create({ data: { name: "Ana", email: "ana@teste.pt", companyId: other.id } });
      const l = await lead({ kind: "PERSON", name: "Ana", email: "ana@teste.pt", companyName: "Nova Lda" });
      const res = await convert(l.id).expect(201);

      expect(res.body.contact.id).toBe(existing.id);
      expect((await prisma.contact.findUniqueOrThrow({ where: { id: existing.id } })).companyId).toBe(other.id);
    });

    it("contacto com o mesmo telefone (com indicativo, no telemóvel): liga; telefone curto não liga ninguém", async () => {
      const prisma = prismaOf(app);
      const byPhone = await prisma.contact.create({ data: { name: "Rui", mobilePhone: "+351 912 345 678" } });
      await prisma.contact.create({ data: { name: "Linha curta", phone: "112" } });

      const l1 = await lead({ kind: "PERSON", name: "Rui Novo", phone: "912345678" });
      const r1 = await convert(l1.id).expect(201);
      expect(r1.body.outcome.contact).toBe("MATCHED");
      expect(r1.body.contact.id).toBe(byPhone.id);

      const l2 = await lead({ kind: "PERSON", name: "Outra Pessoa", phone: "112" });
      const r2 = await convert(l2.id).expect(201);
      expect(r2.body.outcome.contact).toBe("CREATED");
      expect(await prisma.contact.count()).toBe(3);
    });

    it("registos ligados têm prioridade sobre os duplicados", async () => {
      const prisma = prismaOf(app);
      const linkedCompany = await prisma.company.create({ data: { name: "Ligada" } });
      const linkedContact = await prisma.contact.create({ data: { name: "Ligado", companyId: linkedCompany.id } });
      await prisma.company.create({ data: { name: "Mesmo NIF", taxId: "501234567" } });
      await prisma.contact.create({ data: { name: "Mesmo email", email: "x@y.pt" } });

      const l = await lead({ kind: "COMPANY", companyName: "Ligada", taxId: "501234567", name: "Ligado", email: "x@y.pt", contactId: linkedContact.id });
      const res = await convert(l.id).expect(201);

      expect(res.body.outcome).toEqual({ company: "LINKED", contact: "LINKED" });
      expect(res.body.company.id).toBe(linkedCompany.id); // herdada do contacto ao criar a lead
      expect(res.body.contact.id).toBe(linkedContact.id);
      expect(await prisma.company.count()).toBe(2);
      expect(await prisma.contact.count()).toBe(2);
    });

    it("lead de pessoa numa empresa existente: contacto novo, com cargo, nessa empresa", async () => {
      const prisma = prismaOf(app);
      const company = await prisma.company.create({ data: { name: "Cliente SA" } });
      const l = await lead({ kind: "PERSON", name: "Marta", jobTitle: "Diretora", companyId: company.id });
      const res = await convert(l.id).expect(201);

      expect(res.body.outcome).toEqual({ company: "LINKED", contact: "CREATED" });
      expect(res.body.contact).toMatchObject({ name: "Marta", jobTitle: "Diretora", companyId: company.id });
      expect(res.body.deal.title).toBe("Oportunidade — Cliente SA");
    });

    it("duas conversões ao mesmo tempo: uma converte, as outras são recusadas e não deixam registos", async () => {
      const l = await lead({ kind: "COMPANY", companyName: "Corrida Lda", name: "Ana Corrida", email: "ana@corrida.pt" });
      const results = await Promise.all([convert(l.id), convert(l.id), convert(l.id)]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400]);
      const prisma = prismaOf(app);
      expect(await prisma.company.count()).toBe(1);
      expect(await prisma.contact.count()).toBe(1);
      expect(await prisma.deal.count()).toBe(1);
    });
  });
});
