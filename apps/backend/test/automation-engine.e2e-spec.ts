import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { AutomationsService } from "../src/automations/automations.service";
import { WebhooksService } from "../src/webhooks/webhooks.service";

// Fase 3a (docs/plano-fase-3-automacoes.md): motor genérico — validação das regras, histórico, catálogo.
describe("Motor de automações (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let comercial: string;
  let pipeline: { id: string; stages: Array<{ id: string; name: string }> };
  const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    comercial = await bearerFor(app, await createUser(prisma(), "COMERCIAL"));
    pipeline = (await api().post("/pipelines").set("Authorization", admin).send({ name: "Vendas" }).expect(201)).body;
  });

  afterAll(async () => {
    await app.close();
  });

  const valid = () => ({
    name: "Valor alto avança",
    entityType: "DEAL",
    workflowId: pipeline.id,
    trigger: "FIELD_CHANGED",
    triggerConfig: { field: "value" },
    conditions: [{ field: "value", operator: "gt", value: 1000 }],
    action: "MOVE_TO_STEP",
    actionConfig: { targetStepId: stage("Em negociação").id },
  });
  const post = (body: Record<string, unknown>) => api().post("/automation-rules").set("Authorization", admin).send(body);
  const createDeal = async (value = 0) =>
    (await api().post("/deals").set("Authorization", comercial).send({ title: "Negócio", pipelineId: pipeline.id, stageId: stage("Novo").id, value }).expect(201)).body as { id: string };
  const runs = async () => (await api().get("/automation-runs").set("Authorization", admin).expect(200)).body.items;

  describe("validação das regras", () => {
    it("aceita uma regra válida e normaliza as configurações", async () => {
      const rule = (await post({ ...valid(), triggerConfig: { field: "value", lixo: 1 }, conditions: [{ field: "value", operator: "gt", value: 1000, lixo: 2 }] }).expect(201)).body;
      expect(rule).toMatchObject({ entityType: "DEAL", trigger: "FIELD_CHANGED", triggerConfig: { field: "value" }, conditions: [{ field: "value", operator: "gt", value: 1000 }], workflow: { id: pipeline.id } });
      const webhook = (await post({ ...valid(), action: "WEBHOOK", actionConfig: {} }).expect(201)).body;
      expect(webhook.actionConfig).toEqual({ event: "automation.triggered" });
    });

    it("recusa (400) o que antes se gravava sem verificação", async () => {
      const typeWithSteps = (await api().post("/work-item-types/VISITA/workflow").set("Authorization", admin).expect(201)).body;
      const cases: Array<[string, Record<string, unknown>]> = [
        ["tipo de registo desconhecido", { entityType: "FERIAS" }],
        ["gatilho desconhecido", { trigger: "CRIADO_ONTEM" }],
        ["ação desconhecida", { action: "APAGAR_TUDO" }],
        ["passo obrigatório em falta", { trigger: "IDLE_IN_STEP", triggerConfig: { days: 3 }, workflowId: null }],
        ["dias inválidos", { trigger: "IDLE_IN_STEP", stepId: stage("Novo").id, triggerConfig: { days: 0 } }],
        ["dias não inteiros", { trigger: "IDLE_IN_STEP", stepId: stage("Novo").id, triggerConfig: { days: 1.5 } }],
        ["campo alterado sem campo", { triggerConfig: {} }],
        ["campo que não se acompanha", { triggerConfig: { field: "outcome" } }],
        ["condição com campo desconhecido", { conditions: [{ field: "x", operator: "eq", value: 1 }] }],
        ["condição com valor errado", { conditions: [{ field: "value", operator: "gt", value: "mil" }] }],
        ["condição com opção inexistente", { conditions: [{ field: "type", operator: "eq", value: "NAVE_ESPACIAL" }] }],
        ["passo de destino em falta", { actionConfig: {} }],
        ["passo de destino de tarefas", { actionConfig: { targetStepId: typeWithSteps.steps[0].id } }],
        ["passo de âmbito de tarefas", { stepId: typeWithSteps.steps[0].id, workflowId: null }],
        ["fluxo de tarefas", { workflowId: typeWithSteps.workflowId }],
        ["evento de webhook inválido", { action: "WEBHOOK", actionConfig: { event: "Não É Válido" } }],
      ];
      for (const [label, patch] of cases) {
        const res = await post({ ...valid(), ...patch });
        expect({ label, status: res.status }).toEqual({ label, status: 400 });
      }
      // Passo de outro funil que não o escolhido.
      const other = (await api().post("/pipelines").set("Authorization", admin).send({ name: "Outro" }).expect(201)).body;
      await post({ ...valid(), stepId: other.stages[0].id }).expect(400);
      expect(await prisma().automationRule.count({ where: { systemKey: null } })).toBe(0);
    });

    it("alterar valida a regra inteira (o que vem por cima do que existe)", async () => {
      const rule = (await post(valid()).expect(201)).body;
      await api().patch(`/automation-rules/${rule.id}`).set("Authorization", admin).send({ trigger: "IDLE_IN_STEP" }).expect(400);
      await api().patch(`/automation-rules/${rule.id}`).set("Authorization", admin).send({ conditions: [{ field: "value", operator: "lt", value: 5 }] }).expect(200);
      const saved = await prisma().automationRule.findUniqueOrThrow({ where: { id: rule.id } });
      expect(saved.conditions).toEqual([{ field: "value", operator: "lt", value: 5 }]);
      expect(saved.trigger).toBe("FIELD_CHANGED");
    });
  });

  describe("histórico de execuções", () => {
    it("regista sucesso e condição não cumprida (com o motivo), e filtra", async () => {
      const rule = (await post(valid()).expect(201)).body;
      const deal = await createDeal();
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ value: 10 }).expect(200);
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ value: 5000 }).expect(200);
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ title: "Só o título" }).expect(200); // nada mudou nos campos

      const items = await runs();
      expect(items.map((r: { outcome: string; message: string }) => [r.outcome, r.message])).toEqual([
        ["SUCCEEDED", "Movido para «Em negociação»"],
        ["SKIPPED", "Condição não cumprida: «Valor» maior que 1000"],
      ]);
      expect(items[0]).toMatchObject({ entityType: "DEAL", entityId: deal.id, trigger: "FIELD_CHANGED", depth: 0, rule: { id: rule.id, name: "Valor alto avança" } });
      const skipped = (await api().get("/automation-runs").query({ outcome: "SKIPPED" }).set("Authorization", admin).expect(200)).body.items;
      expect(skipped).toHaveLength(1);
      const page = (await api().get("/automation-runs").query({ limit: 1 }).set("Authorization", admin).expect(200)).body;
      expect(page.items).toHaveLength(1);
      const next = (await api().get("/automation-runs").query({ limit: 1, cursor: page.nextCursor }).set("Authorization", admin).expect(200)).body;
      expect(next.items[0].id).not.toBe(page.items[0].id);
    });

    it("«campo alterado» só reage ao campo da regra", async () => {
      await post({ ...valid(), triggerConfig: { field: "probability" }, conditions: [] }).expect(201);
      const deal = await createDeal();
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ value: 5000 }).expect(200);
      expect(await runs()).toEqual([]);
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ probability: 40 }).expect(200);
      expect((await runs()).map((r: { outcome: string }) => r.outcome)).toEqual(["SUCCEEDED"]);
    });

    it("uma ação que falha fica registada e não impede a alteração do negócio", async () => {
      const lonely = (await api().post(`/pipelines/${pipeline.id}/stages`).set("Authorization", admin).send({ name: "Temporária" }).expect(201)).body;
      await post({ ...valid(), actionConfig: { targetStepId: lonely.id } }).expect(201);
      await prisma().workflowStep.delete({ where: { id: lonely.id } }); // o destino desaparece depois de a regra existir
      const deal = await createDeal();
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ value: 5000 }).expect(200);
      expect((await prisma().deal.findUniqueOrThrow({ where: { id: deal.id } })).value).toBe(5000);
      expect((await runs()).map((r: { outcome: string; message: string }) => [r.outcome, r.message])).toEqual([["FAILED", "O passo de destino já não existe"]]);
    });

    it("o webhook leva o tipo e o id do registo (e o dealId de sempre)", async () => {
      const trigger = jest.spyOn(app.get(WebhooksService), "trigger");
      await post({ ...valid(), action: "WEBHOOK", actionConfig: { event: "automation.valor_alto" } }).expect(201);
      const deal = await createDeal();
      await api().patch(`/deals/${deal.id}`).set("Authorization", comercial).send({ value: 5000 }).expect(200);
      expect(trigger).toHaveBeenCalledWith("automation.valor_alto", expect.objectContaining({ entityType: "DEAL", entityId: deal.id, dealId: deal.id, ruleName: "Valor alto avança" }));
      trigger.mockRestore();
    });

    it("só o Administrador vê o histórico; a limpeza tira os registos com mais de 90 dias", async () => {
      await api().get("/automation-runs").set("Authorization", comercial).expect(403);
      const rule = (await post(valid()).expect(201)).body;
      const old = new Date(Date.now() - 91 * 24 * 3600 * 1000);
      await prisma().automationRun.createMany({
        data: [
          { ruleId: rule.id, entityType: "DEAL", entityId: "x", trigger: "FIELD_CHANGED", outcome: "SUCCEEDED", createdAt: old },
          { ruleId: rule.id, entityType: "DEAL", entityId: "y", trigger: "FIELD_CHANGED", outcome: "SUCCEEDED" },
        ],
      });
      await app.get(AutomationsService).purgeOldRuns();
      expect((await prisma().automationRun.findMany()).map((r) => r.entityId)).toEqual(["y"]);
    });
  });

  describe("catálogo e módulos", () => {
    it("o catálogo descreve o que os registos oferecem", async () => {
      const catalog = (await api().get("/automation-rules/catalog").set("Authorization", admin).expect(200)).body;
      const deal = catalog.entities.find((e: { id: string }) => e.id === "DEAL");
      expect(deal.triggers.map((t: { id: string }) => t.id)).toEqual(["IDLE_IN_STEP", "ALL_TASKS_CLOSED", "FIELD_CHANGED", "CREATED", "ENTERED_STEP", "CLOSED"]);
      expect(deal.actions.map((a: { id: string }) => a.id)).toEqual(["MOVE_TO_STEP", "WEBHOOK", "CREATE_WORK_ITEM", "ASSIGN"]);
      expect(catalog.entities.map((e: { id: string }) => e.id)).toEqual(["DEAL", "WORK_ITEM", "LEAD"]);
      expect(deal.fields.map((f: { name: string }) => f.name)).toContain("value");
      expect(catalog.operatorsByKind.number).toContain("gt");
      await api().get("/automation-rules/catalog").set("Authorization", comercial).expect(403);
    });

    it("com os módulos de automações e negócios desligados, as regras de negócios não correm", async () => {
      await post(valid()).expect(201);
      const deal = await createDeal();
      await api().patch("/modules/automations").set("Authorization", admin).send({ enabled: false }).expect(200);
      await api().patch("/modules/deals").set("Authorization", admin).send({ enabled: false }).expect(200);
      await app.get(AutomationsService).dispatch({ entityType: "DEAL", entityId: deal.id, trigger: "FIELD_CHANGED", changedFields: ["value"] });
      await api().patch("/modules/deals").set("Authorization", admin).send({ enabled: true }).expect(200);
      await api().patch("/modules/automations").set("Authorization", admin).send({ enabled: true }).expect(200);
      expect(await prisma().automationRun.count()).toBe(0);
    });
  });
});
