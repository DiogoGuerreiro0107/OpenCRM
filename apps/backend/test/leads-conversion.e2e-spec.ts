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
});
