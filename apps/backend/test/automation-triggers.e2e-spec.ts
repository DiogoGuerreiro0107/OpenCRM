import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { addBusinessDays } from "../src/automations/registry/helpers";

// Fase 3b (docs/plano-fase-3-automacoes.md): tarefas e leads com automações, gatilhos «criado», «entrou no passo» e
// «fechado», ações «criar tarefa» e «atribuir», campos personalizados nas condições e a regra do sistema das leads.
describe("Automações: gatilhos e ações novos (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let adminUser: { id: string };
  let rita: { id: string };
  let ritaAuth: string;
  let rui: { id: string };
  let pipeline: { id: string; stages: Array<{ id: string; name: string }> };
  const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    adminUser = await createUser(prisma(), "ADMINISTRADOR", "Admin");
    admin = await bearerFor(app, adminUser as never);
    rita = await createUser(prisma(), "COMERCIAL", "Rita");
    ritaAuth = await bearerFor(app, rita as never);
    rui = await createUser(prisma(), "TECNICO", "Rui");
    pipeline = (await api().post("/pipelines").set("Authorization", admin).send({ name: "Vendas" }).expect(201)).body;
  });

  afterAll(async () => {
    await app.close();
  });

  const rule = (body: Record<string, unknown>) => api().post("/automation-rules").set("Authorization", admin).send({ name: "Regra", ...body });
  const createTaskRule = (body: Record<string, unknown>, actionConfig: Record<string, unknown> = {}) =>
    rule({ action: "CREATE_WORK_ITEM", actionConfig: { typeId: "TAREFA", title: "Seguimento", assignee: { mode: "OWNER" }, ...actionConfig }, ...body });
  const tasksTitled = (title: string) => prisma().workItem.findMany({ where: { title }, orderBy: { createdAt: "asc" } });
  const newDeal = async (auth = ritaAuth, value = 0) =>
    (await api().post("/deals").set("Authorization", auth).send({ title: "Impressoras", pipelineId: pipeline.id, stageId: stage("Novo").id, value }).expect(201)).body as { id: string };
  const newTask = async (body: Record<string, unknown>, auth = ritaAuth) => (await api().post("/tasks").set("Authorization", auth).send(body).expect(201)).body as { id: string };
  const runs = () => prisma().automationRun.findMany({ orderBy: { createdAt: "asc" } });
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  describe("regra do sistema: primeiro contacto da lead", () => {
    it("a lead nova cria a mesma tarefa de sempre; desativada, deixa de criar; não se apaga, mas edita-se", async () => {
      const lead = (await api().post("/leads").set("Authorization", ritaAuth).send({ name: "Ana", responsavelId: rui.id }).expect(201)).body;
      const [task] = await prisma().workItem.findMany({ where: { leadId: lead.id } });
      expect(task).toMatchObject({ title: "Contactar lead: Ana", typeId: "TAREFA", status: "PENDING", assigneeId: rui.id, companyId: null, dealId: null });
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(sameDay(task.dueDate!, tomorrow)).toBe(true);

      const system = await prisma().automationRule.findUniqueOrThrow({ where: { systemKey: "lead.first_contact" } });
      await api().delete(`/automation-rules/${system.id}`).set("Authorization", admin).expect(400);
      await api().patch(`/automation-rules/${system.id}`).set("Authorization", admin).send({ actionConfig: { ...(system.actionConfig as object), title: "Ligar a {nome} ({empresa})" } }).expect(200);
      const lead2 = (await api().post("/leads").set("Authorization", ritaAuth).send({ name: "Bruno", companyName: "Beta" }).expect(201)).body;
      expect((await prisma().workItem.findFirstOrThrow({ where: { leadId: lead2.id } })).title).toBe("Ligar a Bruno (Beta)");

      await api().patch(`/automation-rules/${system.id}`).set("Authorization", admin).send({ active: false }).expect(200);
      const lead3 = (await api().post("/leads").set("Authorization", ritaAuth).send({ name: "Carla" }).expect(201)).body;
      expect(await prisma().workItem.count({ where: { leadId: lead3.id } })).toBe(0);
    });
  });

  describe("criar tarefa", () => {
    it("na criação de uma visita: modelo com variáveis, prazo em dias úteis, ligações e responsável do registo", async () => {
      await createTaskRule(
        { entityType: "WORK_ITEM", trigger: "CREATED", conditions: [{ field: "typeId", operator: "eq", value: "VISITA" }] },
        { title: "Relatório de {titulo} — {empresa} {contacto}", due: { amount: 2, unit: "business_days" }, priority: "ALTA" },
      ).expect(201);
      const company = await prisma().company.create({ data: { name: "Acme" } });
      const visit = await newTask({ title: "Visita Acme", typeId: "VISITA", companyId: company.id, assigneeId: rui.id });

      const [follow] = await tasksTitled("Relatório de Visita Acme — Acme"); // contacto vazio: some
      expect(follow).toMatchObject({ typeId: "TAREFA", assigneeId: rui.id, companyId: company.id, priority: "ALTA" });
      expect(sameDay(follow.dueDate!, addBusinessDays(new Date(), 2))).toBe(true);
      // A tarefa criada é do tipo TAREFA: a condição não a deixa disparar outra vez.
      expect(await prisma().workItem.count()).toBe(2);
      // A tarefa criada também passa pela regra (cadeia, profundidade 1), mas a condição não se cumpre.
      expect((await runs()).map((r) => [r.entityId === visit.id ? "visita" : "seguimento", r.outcome, r.depth]).sort()).toEqual([
        ["seguimento", "SKIPPED", 1],
        ["visita", "SUCCEEDED", 0],
      ]);
    });

    it("responsável: o do registo (ou quem fez), quem fez (ou o do registo), ou um utilizador fixo", async () => {
      await createTaskRule({ entityType: "LEAD", trigger: "CREATED" }, { title: "OWNER {nome}", assignee: { mode: "OWNER" } }).expect(201);
      await createTaskRule({ entityType: "LEAD", trigger: "CREATED" }, { title: "ACTOR {nome}", assignee: { mode: "ACTOR" } }).expect(201);
      await createTaskRule({ entityType: "LEAD", trigger: "CREATED" }, { title: "USER {nome}", assignee: { mode: "USER", userId: rui.id } }).expect(201);
      await api().post("/leads").set("Authorization", ritaAuth).send({ name: "Com responsável", responsavelId: adminUser.id }).expect(201);
      await api().post("/leads").set("Authorization", ritaAuth).send({ name: "Sem responsável" }).expect(201);
      const assignee = async (title: string) => (await tasksTitled(title))[0]?.assigneeId;
      expect(await assignee("OWNER Com responsável")).toBe(adminUser.id);
      expect(await assignee("OWNER Sem responsável")).toBe(rita.id);
      expect(await assignee("ACTOR Com responsável")).toBe(rita.id);
      expect(await assignee("USER Sem responsável")).toBe(rui.id);
    });

    it("prazo em horas e dias; validação do modelo", async () => {
      await createTaskRule({ entityType: "DEAL", trigger: "CREATED" }, { title: "H {titulo}", due: { amount: 3, unit: "hours" } }).expect(201);
      const before = Date.now();
      await newDeal();
      const [h] = await tasksTitled("H Impressoras");
      expect(h.dueDate!.getTime() - before).toBeGreaterThanOrEqual(3 * 3600_000 - 1000);
      expect(h.dueDate!.getTime() - before).toBeLessThan(3 * 3600_000 + 60_000);
      expect(h.dealId).not.toBeNull();

      const bad: Array<Record<string, unknown>> = [
        { typeId: "NAO_EXISTE" },
        { title: "   " },
        { title: "Olá {nome}" }, // {nome} não é variável dos negócios
        { assignee: { mode: "ALGUEM" } },
        { assignee: { mode: "USER", userId: "fantasma" } },
        { due: { amount: -1, unit: "days" } },
        { due: { amount: 2, unit: "semanas" } },
        { priority: "MUITO_ALTA" },
      ];
      for (const patch of bad) {
        const res = await createTaskRule({ entityType: "DEAL", trigger: "CREATED" }, patch);
        expect({ patch, status: res.status }).toEqual({ patch, status: 400 });
      }
      await api().patch("/work-item-types/VISITA").set("Authorization", admin).send({ active: false }).expect(200);
      await createTaskRule({ entityType: "DEAL", trigger: "CREATED" }, { typeId: "VISITA" }).expect(400);
    });

    it("num tipo com passos, a tarefa criada entra no primeiro passo", async () => {
      const visita = (await api().post("/work-item-types/VISITA/workflow").set("Authorization", admin).expect(201)).body;
      await createTaskRule({ entityType: "DEAL", trigger: "CREATED" }, { typeId: "VISITA", title: "Visitar {empresa}" }).expect(201);
      await newDeal();
      const [task] = await tasksTitled("Visitar");
      expect(task).toMatchObject({ typeId: "VISITA", stepId: visita.steps[0].id, status: "PENDING" });
    });

    it("ciclos: uma regra que cria tarefas a cada tarefa criada para ao fim de 3 automações seguidas", async () => {
      await createTaskRule({ entityType: "WORK_ITEM", trigger: "CREATED" }, { title: "Eco de {titulo}" }).expect(201);
      await newTask({ title: "Original" });
      // pessoa → automação (1) → (2) → (3); a 4.ª é cortada.
      expect(await prisma().workItem.count()).toBe(5);
      const skipped = (await runs()).filter((r) => r.outcome === "SKIPPED");
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toMatchObject({ depth: 4, message: expect.stringMatching(/demasiado longa/) });
    });
  });

  describe("entrou no passo e fechado", () => {
    it("negócio: arrastar para a fase cria o seguimento a +2 dias úteis; ganhar dispara «fechado» com resultado", async () => {
      const proposal = (await api().post(`/pipelines/${pipeline.id}/stages`).set("Authorization", admin).send({ name: "Proposta enviada" }).expect(201)).body;
      await createTaskRule({ entityType: "DEAL", trigger: "ENTERED_STEP", stepId: proposal.id }, { title: "Seguimento da proposta: {titulo}", due: { amount: 2, unit: "business_days" } }).expect(201);
      await rule({ entityType: "DEAL", trigger: "CLOSED", conditions: [{ field: "outcome", operator: "eq", value: "WON" }], action: "WEBHOOK", actionConfig: { event: "automation.ganho" } }).expect(201);
      const deal = await newDeal();

      await api().patch(`/deals/${deal.id}/move`).set("Authorization", ritaAuth).send({ stageId: proposal.id, index: 0 }).expect(200);
      const [follow] = await tasksTitled("Seguimento da proposta: Impressoras");
      expect(follow).toMatchObject({ dealId: deal.id, assigneeId: rita.id });
      expect(sameDay(follow.dueDate!, addBusinessDays(new Date(), 2))).toBe(true);
      // Mover dentro da mesma fase não volta a entrar.
      await api().patch(`/deals/${deal.id}/move`).set("Authorization", ritaAuth).send({ stageId: proposal.id, index: 0 }).expect(200);
      expect(await tasksTitled("Seguimento da proposta: Impressoras")).toHaveLength(1);

      await api().patch(`/deals/${deal.id}/move`).set("Authorization", ritaAuth).send({ stageId: stage("Ganho").id, index: 0 }).expect(200);
      expect((await runs()).map((r) => [r.trigger, r.outcome, r.message])).toEqual([
        ["ENTERED_STEP", "SUCCEEDED", "Tarefa «Seguimento da proposta: Impressoras» criada"],
        ["CLOSED", "SUCCEEDED", "Webhook «automation.ganho»"],
      ]);
    });

    it("negócio movido por uma automação também «entra no passo» (cadeia de profundidade 1)", async () => {
      await rule({ entityType: "DEAL", trigger: "FIELD_CHANGED", triggerConfig: { field: "value" }, conditions: [{ field: "value", operator: "gt", value: 1000 }], action: "MOVE_TO_STEP", actionConfig: { targetStepId: stage("Em negociação").id } }).expect(201);
      await createTaskRule({ entityType: "DEAL", trigger: "ENTERED_STEP", stepId: stage("Em negociação").id }, { title: "Negociar {titulo}" }).expect(201);
      const deal = await newDeal();
      await api().patch(`/deals/${deal.id}`).set("Authorization", ritaAuth).send({ value: 5000 }).expect(200);
      expect(await tasksTitled("Negociar Impressoras")).toHaveLength(1);
      // Cada execução regista-se quando acaba: a que a ação desencadeou fica antes dela.
      expect((await runs()).map((r) => [r.trigger, r.depth]).sort()).toEqual([["ENTERED_STEP", 1], ["FIELD_CHANGED", 0]]);
    });

    it("tarefas: entrar num passo, concluir e mover por automação (com a timeline de sempre)", async () => {
      const visita = (await api().post("/work-item-types/VISITA/workflow").set("Authorization", admin).expect(201)).body;
      const [porFazer, emCurso, concluida] = visita.steps;
      // Mover só nas tarefas deste tipo: sem o fluxo do tipo na regra é recusado.
      await rule({ entityType: "WORK_ITEM", trigger: "CREATED", action: "MOVE_TO_STEP", actionConfig: { targetStepId: emCurso.id } }).expect(400);
      await rule({ entityType: "WORK_ITEM", trigger: "CREATED", workflowId: visita.workflowId, action: "MOVE_TO_STEP", actionConfig: { targetStepId: emCurso.id } }).expect(201);
      await createTaskRule({ entityType: "WORK_ITEM", trigger: "ENTERED_STEP", stepId: concluida.id }, { title: "Faturar {titulo}" }).expect(201);
      await rule({ entityType: "WORK_ITEM", trigger: "CLOSED", conditions: [{ field: "status", operator: "eq", value: "DONE" }], action: "WEBHOOK", actionConfig: { event: "automation.visita_feita" } }).expect(201);

      const company = await prisma().company.create({ data: { name: "Acme" } });
      const t = await newTask({ title: "Visita", typeId: "VISITA", companyId: company.id });
      expect(await prisma().workItem.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ stepId: emCurso.id, status: "IN_PROGRESS" });
      expect(porFazer).toBeDefined();

      await api().patch(`/tasks/${t.id}`).set("Authorization", ritaAuth).send({ stepId: concluida.id }).expect(200);
      expect(await tasksTitled("Faturar Visita")).toHaveLength(1);
      // Editar a tarefa sem mudar de passo não volta a «entrar».
      await api().patch(`/tasks/${t.id}`).set("Authorization", ritaAuth).send({ title: "Visita", priority: "ALTA" }).expect(200);
      expect(await tasksTitled("Faturar Visita")).toHaveLength(1);
      expect((await runs()).filter((r) => r.trigger === "CLOSED").map((r) => r.message)).toEqual(["Webhook «automation.visita_feita»"]);
      expect(await prisma().timelineEvent.count({ where: { entityId: company.id, description: 'Tarefa concluída: "Visita".' } })).toBe(1);
    });

    it("leads: perder e converter disparam «fechado»; converter dispara também «criado» no negócio", async () => {
      await rule({ entityType: "LEAD", trigger: "CLOSED", conditions: [{ field: "status", operator: "eq", value: "PERDIDO" }], action: "WEBHOOK", actionConfig: { event: "automation.lead_perdida" } }).expect(201);
      await createTaskRule({ entityType: "DEAL", trigger: "CREATED" }, { title: "Boas-vindas {titulo}" }).expect(201);
      const lost = (await api().post("/leads").set("Authorization", ritaAuth).send({ name: "Perdida" }).expect(201)).body;
      await api().patch(`/leads/${lost.id}`).set("Authorization", ritaAuth).send({ status: "PERDIDO" }).expect(200);
      await api().patch(`/leads/${lost.id}`).set("Authorization", ritaAuth).send({ notes: "nota" }).expect(200); // continua perdida: não volta a fechar

      const lead = (await api().post("/leads").set("Authorization", ritaAuth).send({ name: "Ana", companyName: "Beta Lda" }).expect(201)).body;
      await api().post(`/leads/${lead.id}/convert`).set("Authorization", ritaAuth).expect(201);
      const closed = (await runs()).filter((r) => r.entityType === "LEAD" && r.trigger === "CLOSED");
      expect(closed.map((r) => [r.entityId, r.outcome])).toEqual([[lost.id, "SUCCEEDED"], [lead.id, "SKIPPED"]]);
      expect((await tasksTitled("Boas-vindas Oportunidade — Beta Lda"))).toHaveLength(1);
    });
  });

  describe("atribuir", () => {
    it("lead de POS vai para o Rui; a mudança de responsável dispara «campo alterado»", async () => {
      await rule({ entityType: "LEAD", trigger: "CREATED", conditions: [{ field: "interest", operator: "eq", value: "POS" }], action: "ASSIGN", actionConfig: { userId: rui.id } }).expect(201);
      await rule({ entityType: "LEAD", trigger: "FIELD_CHANGED", triggerConfig: { field: "responsavelId" }, action: "WEBHOOK", actionConfig: { event: "automation.lead_atribuida" } }).expect(201);
      await rule({ entityType: "LEAD", trigger: "CREATED", action: "ASSIGN", actionConfig: { userId: "fantasma" } }).expect(400);

      const pos = (await api().post("/leads").set("Authorization", ritaAuth).send({ name: "Loja", interest: "POS" }).expect(201)).body;
      const other = (await api().post("/leads").set("Authorization", ritaAuth).send({ name: "Outra", interest: "PAPELARIA" }).expect(201)).body;
      expect((await prisma().lead.findUniqueOrThrow({ where: { id: pos.id } })).responsavelId).toBe(rui.id);
      expect((await prisma().lead.findUniqueOrThrow({ where: { id: other.id } })).responsavelId).toBeNull();
      const assigned = (await runs()).filter((r) => r.trigger === "FIELD_CHANGED");
      expect(assigned.map((r) => [r.entityId, r.depth, r.message])).toEqual([[pos.id, 1, "Webhook «automation.lead_atribuida»"]]);
    });
  });

  describe("campos personalizados nas condições", () => {
    it("só os «disponíveis em automações»; sim/não e listas comparam com as opções", async () => {
      const tracked = (await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "DEAL", fieldLabel: "Campanha", fieldType: "SELECT", options: ["Natal", "Verão"] }).expect(201)).body;
      await prisma().customField.update({ where: { id: tracked.id }, data: { isAutomationEnabled: true } });
      const vip = (await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "DEAL", fieldLabel: "VIP", fieldType: "BOOLEAN" }).expect(201)).body;
      await prisma().customField.update({ where: { id: vip.id }, data: { isAutomationEnabled: true } });
      const hidden = (await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "DEAL", fieldLabel: "Nota", fieldType: "TEXT" }).expect(201)).body;

      const catalog = (await api().get("/automation-rules/catalog").set("Authorization", admin).expect(200)).body;
      const dealFields = catalog.entities.find((e: { id: string }) => e.id === "DEAL").fields.map((f: { name: string }) => f.name);
      expect(dealFields).toEqual(expect.arrayContaining([`cf:${tracked.id}`, `cf:${vip.id}`]));
      expect(dealFields).not.toContain(`cf:${hidden.id}`);
      await rule({ entityType: "DEAL", trigger: "FIELD_CHANGED", triggerConfig: { field: "value" }, conditions: [{ field: `cf:${hidden.id}`, operator: "eq", value: "x" }], action: "WEBHOOK" }).expect(400);
      await rule({ entityType: "DEAL", trigger: "FIELD_CHANGED", triggerConfig: { field: "value" }, conditions: [{ field: `cf:${tracked.id}`, operator: "eq", value: "Páscoa" }], action: "WEBHOOK" }).expect(400);

      await createTaskRule(
        { entityType: "DEAL", trigger: "FIELD_CHANGED", triggerConfig: { field: "value" }, conditions: [{ field: `cf:${tracked.id}`, operator: "eq", value: "Natal" }, { field: `cf:${vip.id}`, operator: "eq", value: "sim" }] },
        { title: "Campanha de Natal: {titulo}" },
      ).expect(201);
      const deal = await newDeal();
      const save = (values: unknown[]) => api().post("/custom-fields/values").set("Authorization", ritaAuth).send({ entityType: "DEAL", entityId: deal.id, values }).expect(201);
      await save([{ customFieldId: tracked.id, value: "Natal" }, { customFieldId: vip.id, value: false }]);
      await api().patch(`/deals/${deal.id}`).set("Authorization", ritaAuth).send({ value: 10 }).expect(200);
      expect(await tasksTitled("Campanha de Natal: Impressoras")).toHaveLength(0);
      await save([{ customFieldId: vip.id, value: true }]);
      await api().patch(`/deals/${deal.id}`).set("Authorization", ritaAuth).send({ value: 20 }).expect(200);
      expect(await tasksTitled("Campanha de Natal: Impressoras")).toHaveLength(1);
      expect((await runs())[0].message).toMatch(/VIP/);
    });
  });

  describe("módulos", () => {
    it("as regras de tarefas correm com os negócios desligados; com as leads desligadas, as de leads não aparecem no catálogo", async () => {
      await createTaskRule({ entityType: "WORK_ITEM", trigger: "CREATED", conditions: [{ field: "typeId", operator: "eq", value: "VISITA" }] }, { title: "Preparar {titulo}" }).expect(201);
      await api().patch("/modules/deals").set("Authorization", admin).send({ enabled: false }).expect(200);
      await newTask({ title: "Visita", typeId: "VISITA" });
      expect(await tasksTitled("Preparar Visita")).toHaveLength(1);
      await api().patch("/modules/deals").set("Authorization", admin).send({ enabled: true }).expect(200);

      await api().patch("/modules/leads").set("Authorization", admin).send({ enabled: false }).expect(200);
      const catalog = (await api().get("/automation-rules/catalog").set("Authorization", admin).expect(200)).body;
      expect(catalog.entities.map((e: { id: string }) => e.id)).toEqual(["DEAL", "WORK_ITEM"]);
      await rule({ entityType: "LEAD", trigger: "CREATED", action: "WEBHOOK" }).expect(400);
      await api().patch("/modules/leads").set("Authorization", admin).send({ enabled: true }).expect(200);
    });
  });
});
