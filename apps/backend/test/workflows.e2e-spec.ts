import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";

// Fluxos genéricos (pacote 0c, docs/plano-fase-0-fundacoes.md). A API /pipelines tem de ficar igual para os
// negócios, e os passos ganham categoria + resultado.
describe("Fluxos genéricos: funis dos negócios sobre Workflow/WorkflowStep (e2e)", () => {
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

  async function setup() {
    const admin = await createUser(prisma(), "ADMINISTRADOR");
    const auth = await bearerFor(app, admin);
    const pipeline = (await api().post("/pipelines").set("Authorization", auth).send({ name: "Vendas" }).expect(201)).body;
    const byName = (name: string) => pipeline.stages.find((s: { name: string }) => s.name === name);
    return { admin, auth, pipeline, byName };
  }

  const newDeal = (auth: string, pipelineId: string, stageId: string, extra: Record<string, unknown> = {}) =>
    api().post("/deals").set("Authorization", auth).send({ title: "Negócio", value: 100, pipelineId, stageId, ...extra }).expect(201);

  describe("a API /pipelines continua igual (mais category/outcome)", () => {
    it("criar funil cria as fases por omissão com type e com a categoria/resultado certos", async () => {
      const { pipeline } = await setup();
      expect(Object.keys(pipeline).sort()).toEqual(["createdAt", "id", "name", "stages", "updatedAt"]);
      expect(pipeline.stages.map((s: Record<string, unknown>) => [s.name, s.order, s.type, s.category, s.outcome, s.pipelineId])).toEqual([
        ["Novo", 0, "OPEN", "OPEN", null, pipeline.id],
        ["Em negociação", 1, "OPEN", "OPEN", null, pipeline.id],
        ["Ganho", 2, "WON", "DONE", "WON", pipeline.id],
        ["Perdido", 3, "LOST", "DONE", "LOST", pipeline.id],
      ]);
      expect(await prisma().workflow.findUniqueOrThrow({ where: { id: pipeline.id } })).toMatchObject({ entityType: "DEAL" });
    });

    it("GET /pipelines inclui a contagem de negócios por fase, como antes", async () => {
      const { auth, pipeline, byName } = await setup();
      await newDeal(auth, pipeline.id, byName("Novo").id);
      const res = await api().get("/pipelines").set("Authorization", auth).expect(200);
      const novo = res.body[0].stages.find((s: { name: string }) => s.name === "Novo");
      expect(novo).toMatchObject({ type: "OPEN", category: "OPEN", outcome: null, _count: { deals: 1 } });
    });

    it("acrescentar e mudar o type de uma fase grava categoria e resultado", async () => {
      const { auth, pipeline } = await setup();
      const added = (await api().post(`/pipelines/${pipeline.id}/stages`).set("Authorization", auth).send({ name: "Fechado por outro", type: "LOST" }).expect(201)).body;
      expect(added).toMatchObject({ type: "LOST", category: "DONE", outcome: "LOST", pipelineId: pipeline.id, order: 4 });

      const reopened = (await api().patch(`/stages/${added.id}`).set("Authorization", auth).send({ type: "OPEN" }).expect(200)).body;
      expect(reopened).toMatchObject({ type: "OPEN", category: "OPEN", outcome: null });
      const renamed = (await api().patch(`/stages/${added.id}`).set("Authorization", auth).send({ name: "Outro" }).expect(200)).body;
      expect(renamed).toMatchObject({ name: "Outro", type: "OPEN" }); // mudar só o nome não mexe na categoria

      await api().post(`/pipelines/${pipeline.id}/stages`).set("Authorization", auth).send({ name: "x", type: "CANCELLED" }).expect(400);
    });

    it("reordenar recusa fases de outro funil (antes eram aceites em silêncio)", async () => {
      const { auth, pipeline } = await setup();
      const other = (await api().post("/pipelines").set("Authorization", auth).send({ name: "Outro" }).expect(201)).body;
      await api()
        .patch(`/pipelines/${pipeline.id}/stages/reorder`)
        .set("Authorization", auth)
        .send({ stages: [{ id: other.stages[0].id, order: 0 }] })
        .expect(400);
      const ok = await api()
        .patch(`/pipelines/${pipeline.id}/stages/reorder`)
        .set("Authorization", auth)
        .send({ stages: pipeline.stages.map((s: { id: string }, i: number) => ({ id: s.id, order: pipeline.stages.length - 1 - i })) })
        .expect(200);
      expect(ok.body.stages[0].name).toBe("Perdido");
    });

    it("fluxos de outros tipos (módulos futuros) não aparecem nem se mexem pela API dos negócios", async () => {
      const { auth } = await setup();
      const foreign = await prisma().workflow.create({ data: { name: "Assistências", entityType: "SERVICE", steps: { create: [{ name: "Recebida", order: 0 }] } }, include: { steps: true } });
      const list = await api().get("/pipelines").set("Authorization", auth).expect(200);
      expect(list.body.map((p: { id: string }) => p.id)).not.toContain(foreign.id);
      await api().get(`/pipelines/${foreign.id}`).set("Authorization", auth).expect(404);
      await api().patch(`/pipelines/${foreign.id}`).set("Authorization", auth).send({ name: "x" }).expect(404);
      await api().delete(`/pipelines/${foreign.id}`).set("Authorization", auth).expect(404);
      await api().patch(`/stages/${foreign.steps[0].id}`).set("Authorization", auth).send({ name: "x" }).expect(404);
      await api().delete(`/stages/${foreign.steps[0].id}`).set("Authorization", auth).expect(404);
      await api().post("/deals").set("Authorization", auth).send({ title: "x", pipelineId: foreign.id, stageId: foreign.steps[0].id }).expect(404);
    });
  });

  describe("comportamento dos negócios mantém-se", () => {
    it("mover para ganho fecha; para perdido exige motivo; voltar a aberto reabre", async () => {
      const { auth, pipeline, byName } = await setup();
      const deal = (await newDeal(auth, pipeline.id, byName("Novo").id)).body;

      await api().patch(`/deals/${deal.id}/move`).set("Authorization", auth).send({ stageId: byName("Perdido").id, index: 0 }).expect(400);
      await api().patch(`/deals/${deal.id}/move`).set("Authorization", auth).send({ stageId: byName("Ganho").id, index: 0 }).expect(200);
      expect((await prisma().deal.findUniqueOrThrow({ where: { id: deal.id } })).closedAt).not.toBeNull();

      await api().patch(`/deals/${deal.id}/move`).set("Authorization", auth).send({ stageId: byName("Novo").id, index: 0 }).expect(200);
      expect((await prisma().deal.findUniqueOrThrow({ where: { id: deal.id } })).closedAt).toBeNull();
    });

    it("dashboard conta abertos, ganhos e perdidos pela categoria/resultado", async () => {
      const { auth, pipeline, byName } = await setup();
      await newDeal(auth, pipeline.id, byName("Novo").id, { value: 100 });
      await newDeal(auth, pipeline.id, byName("Em negociação").id, { value: 50 });
      await newDeal(auth, pipeline.id, byName("Ganho").id, { value: 999 });
      await newDeal(auth, pipeline.id, byName("Perdido").id, { value: 1, lossReason: "Preço" });

      const res = await api().get("/dashboard/summary").set("Authorization", auth).expect(200);
      expect(res.body).toMatchObject({ dealsOpen: 2, dealsWon: 1, dealsLost: 1, openValue: 150 });
      expect(res.body.pipelines[0]).toMatchObject({ name: "Vendas", open: 2, won: 1, lost: 1, conversionRate: 50 });
    });

    it("uma fase IN_PROGRESS (categoria nova) conta como aberta em todo o lado", async () => {
      const { auth, pipeline, byName } = await setup();
      await prisma().workflowStep.update({ where: { id: byName("Em negociação").id }, data: { category: "IN_PROGRESS" } });
      const deal = (await newDeal(auth, pipeline.id, byName("Em negociação").id, { value: 70 })).body;
      expect((await prisma().deal.findUniqueOrThrow({ where: { id: deal.id } })).closedAt).toBeNull();
      const res = await api().get("/dashboard/summary").set("Authorization", auth).expect(200);
      expect(res.body).toMatchObject({ dealsOpen: 1, openValue: 70 });
      const list = await api().get("/pipelines").set("Authorization", auth).expect(200);
      expect(list.body[0].stages.find((s: { name: string }) => s.name === "Em negociação")).toMatchObject({ type: "OPEN", category: "IN_PROGRESS" });
    });

    it("a conversão de lead usa o primeiro funil de negócios e a primeira fase aberta", async () => {
      const { auth, pipeline } = await setup();
      // a primeira fase passa a ser de ganho: a conversão tem de saltar para a primeira ABERTA
      await api()
        .patch(`/pipelines/${pipeline.id}/stages/reorder`)
        .set("Authorization", auth)
        .send({ stages: pipeline.stages.map((s: { id: string; name: string }) => ({ id: s.id, order: s.name === "Ganho" ? 0 : s.name === "Novo" ? 2 : s.name === "Em negociação" ? 1 : 3 })) })
        .expect(200);
      const lead = await prisma().lead.create({ data: { name: "Lead", companyName: "Acme" } });
      const res = await api().post(`/leads/${lead.id}/convert`).set("Authorization", auth).expect((r) => expect([200, 201]).toContain(r.status));
      const dealId = res.body.deal?.id ?? res.body.dealId ?? (await prisma().deal.findFirstOrThrow()).id;
      const deal = await prisma().deal.findUniqueOrThrow({ where: { id: dealId }, include: { stage: true } });
      expect(deal.stage.name).toBe("Em negociação");
    });
  });

  describe("apagar uma fase com negócios: mover para outra", () => {
    it("sem destino é recusado com a contagem", async () => {
      const { auth, pipeline, byName } = await setup();
      await newDeal(auth, pipeline.id, byName("Novo").id);
      await newDeal(auth, pipeline.id, byName("Novo").id);
      const res = await api().delete(`/stages/${byName("Novo").id}`).set("Authorization", auth).expect(400);
      expect(res.body.message).toContain("2 negócio");
      expect(await prisma().workflowStep.count({ where: { id: byName("Novo").id } })).toBe(1);
    });

    it("com destino, os negócios são movidos e a fase apagada (na mesma operação)", async () => {
      const { auth, pipeline, byName } = await setup();
      const a = (await newDeal(auth, pipeline.id, byName("Novo").id)).body;
      const b = (await newDeal(auth, pipeline.id, byName("Novo").id)).body;
      await api().delete(`/stages/${byName("Novo").id}`).query({ moveTo: byName("Em negociação").id }).set("Authorization", auth).expect(204);

      expect(await prisma().workflowStep.count({ where: { id: byName("Novo").id } })).toBe(0);
      const moved = await prisma().deal.findMany({ where: { id: { in: [a.id, b.id] } } });
      expect(moved.every((d) => d.stageId === byName("Em negociação").id && d.closedAt === null)).toBe(true);
      expect(await prisma().auditEvent.count({ where: { action: "pipeline.stage_deleted" } })).toBe(1);
    });

    it("mover para uma fase ganha fecha os negócios; para perdida exige motivo em todos", async () => {
      const { auth, pipeline, byName } = await setup();
      const withReason = (await newDeal(auth, pipeline.id, byName("Novo").id, { lossReason: "Preço" })).body;
      await newDeal(auth, pipeline.id, byName("Novo").id); // sem motivo

      const refused = await api().delete(`/stages/${byName("Novo").id}`).query({ moveTo: byName("Perdido").id }).set("Authorization", auth).expect(400);
      expect(refused.body.message).toContain("motivo de perda");
      expect(await prisma().deal.count({ where: { stageId: byName("Novo").id } })).toBe(2); // nada mudou

      await api().delete(`/stages/${byName("Novo").id}`).query({ moveTo: byName("Ganho").id }).set("Authorization", auth).expect(204);
      const closed = await prisma().deal.findMany();
      expect(closed.every((d) => d.stageId === byName("Ganho").id && d.closedAt !== null)).toBe(true);
      expect(closed.find((d) => d.id === withReason.id)).toBeDefined();
    });

    it("destino de outro funil, inexistente, ou a própria fase é recusado", async () => {
      const { auth, pipeline, byName } = await setup();
      await newDeal(auth, pipeline.id, byName("Novo").id);
      const other = (await api().post("/pipelines").set("Authorization", auth).send({ name: "Outro" }).expect(201)).body;
      await api().delete(`/stages/${byName("Novo").id}`).query({ moveTo: other.stages[0].id }).set("Authorization", auth).expect(400);
      await api().delete(`/stages/${byName("Novo").id}`).query({ moveTo: "00000000-0000-4000-8000-000000000000" }).set("Authorization", auth).expect(400);
      await api().delete(`/stages/${byName("Novo").id}`).query({ moveTo: byName("Novo").id }).set("Authorization", auth).expect(400);
      expect(await prisma().deal.count({ where: { stageId: byName("Novo").id } })).toBe(1);
    });

    it("fase vazia apaga-se sem destino, como antes", async () => {
      const { auth, byName } = await setup();
      await api().delete(`/stages/${byName("Em negociação").id}`).set("Authorization", auth).expect(204);
    });
  });

  describe("integridade na base de dados", () => {
    it("um resultado só é aceite num passo concluído (restrição CHECK)", async () => {
      const { byName } = await setup();
      await expect(prisma().workflowStep.update({ where: { id: byName("Novo").id }, data: { outcome: "WON" } })).rejects.toThrow();
    });
  });
});
