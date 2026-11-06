import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

describe("Motor de automações (e2e)", () => {
  let app: INestApplication;
  let admin: string;
  let comercial: string;
  let pipeline: { id: string; stages: Array<{ id: string; name: string }> };

  const api = () => request(app.getHttpServer());
  const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    const prisma = prismaOf(app);
    await resetDatabase(prisma);
    admin = await bearerFor(app, await createUser(prisma, "ADMINISTRADOR"));
    comercial = await bearerFor(app, await createUser(prisma, "COMERCIAL"));
    pipeline = (await api().post("/pipelines").set("Authorization", admin).send({ name: "Vendas" }).expect(201)).body;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createDeal(stageId: string, value = 100) {
    const res = await api()
      .post("/deals")
      .set("Authorization", comercial)
      .send({ title: "Negócio de teste", pipelineId: pipeline.id, stageId, value })
      .expect(201);
    return res.body as { id: string };
  }

  const currentStage = async (dealId: string) =>
    (await api().get(`/deals/${dealId}`).set("Authorization", comercial).expect(200)).body.stageId as string;

  describe("gatilho: campo alterado", () => {
    beforeEach(async () => {
      await api()
        .post("/automation-rules")
        .set("Authorization", admin)
        .send({
          name: "Valor alto avança",
          pipelineId: pipeline.id,
          triggerType: "FIELD_CHANGED",
          triggerConfig: { field: "value", operator: "gt", value: 1000 },
          actionType: "MOVE_STAGE",
          actionConfig: { targetStageId: stage("Em negociação").id },
        })
        .expect(201);
    });

    it("move o negócio quando o valor passa o limite", async () => {
      const deal = await createDeal(stage("Novo").id);
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ value: 5000 }).expect(200);
      expect(await currentStage(deal.id)).toBe(stage("Em negociação").id);
    });

    it("não move quando a condição não se verifica", async () => {
      const deal = await createDeal(stage("Novo").id);
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ value: 500 }).expect(200);
      expect(await currentStage(deal.id)).toBe(stage("Novo").id);
    });

    it("regra desativada não dispara", async () => {
      const rules = (await api().get("/automation-rules").set("Authorization", admin).expect(200)).body;
      await api().patch(`/automation-rules/${rules[0].id}`).set("Authorization", admin).send({ active: false }).expect(200);

      const deal = await createDeal(stage("Novo").id);
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ value: 5000 }).expect(200);
      expect(await currentStage(deal.id)).toBe(stage("Novo").id);
    });
  });

  describe("gatilho: tarefas concluídas", () => {
    beforeEach(async () => {
      await api()
        .post("/automation-rules")
        .set("Authorization", admin)
        .send({
          name: "Tarefas feitas avança",
          stageId: stage("Novo").id,
          triggerType: "TASK_COMPLETED",
          triggerConfig: {},
          actionType: "MOVE_STAGE",
          actionConfig: { targetStageId: stage("Em negociação").id },
        })
        .expect(201);
    });

    it("só move quando TODAS as tarefas do negócio estão concluídas", async () => {
      const deal = await createDeal(stage("Novo").id);
      const newTask = async (title: string) =>
        (await api().post("/tasks").set("Authorization", comercial).send({ title, dealId: deal.id }).expect(201)).body;
      const t1 = await newTask("T1");
      const t2 = await newTask("T2");

      await api().patch(`/tasks/${t1.id}`).set("Authorization", comercial).send({ status: "DONE" }).expect(200);
      expect(await currentStage(deal.id)).toBe(stage("Novo").id); // falta a T2

      await api().patch(`/tasks/${t2.id}`).set("Authorization", comercial).send({ status: "DONE" }).expect(200);
      expect(await currentStage(deal.id)).toBe(stage("Em negociação").id);
    });
  });

  it("uma automação pode mover para a fase de perdido sem motivo de perda (decisão documentada)", async () => {
    // docs/decisoes.md: movimentos feitos por automação não passam pela validação de "motivo de perda
    // obrigatório" do move() manual — senão a automação ficava bloqueada à espera de uma pessoa.
    await api()
      .post("/automation-rules")
      .set("Authorization", admin)
      .send({
        name: "Valor mínimo perde",
        pipelineId: pipeline.id,
        triggerType: "FIELD_CHANGED",
        triggerConfig: { field: "value", operator: "lt", value: 10 },
        actionType: "MOVE_STAGE",
        actionConfig: { targetStageId: stage("Perdido").id },
      })
      .expect(201);

    const deal = await createDeal(stage("Novo").id);
    await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ value: 1 }).expect(200);
    expect(await currentStage(deal.id)).toBe(stage("Perdido").id);
  });

  it("só o Administrador gere regras (um Comercial não consegue criar)", async () => {
    await api()
      .post("/automation-rules")
      .set("Authorization", comercial)
      .send({ name: "x", triggerType: "FIELD_CHANGED", triggerConfig: {}, actionType: "TRIGGER_WEBHOOK", actionConfig: {} })
      .expect(403);
  });
});
