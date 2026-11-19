import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

// Fase 2b (docs/plano-fase-2-itens-de-trabalho.md): passos por tipo de tarefa, rotas genéricas de fluxos e campos
// personalizados por tipo.
describe("Passos e campos por tipo de tarefa (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
  });

  afterAll(async () => {
    await app.close();
  });

  interface Step {
    id: string;
    name: string;
    order: number;
    category: string;
  }
  interface TypeView {
    id: string;
    workflowId: string | null;
    steps: Step[];
  }

  const as = async (role: Role) => bearerFor(app, await createUser(prisma(), role));
  const giveSteps = async (admin: string, typeId: string) =>
    (await api().post(`/work-item-types/${typeId}/workflow`).set("Authorization", admin).expect(201)).body as TypeView;
  const newTask = async (auth: string, body: Record<string, unknown>) =>
    (await api().post("/tasks").set("Authorization", auth).send(body).expect(201)).body as {
      id: string;
      status: string;
      stepId: string | null;
      step: { id: string; name: string; category: string } | null;
    };
  const task = (id: string) => prisma().workItem.findUniqueOrThrow({ where: { id } });
  const stepNamed = (type: TypeView, name: string) => type.steps.find((s) => s.name === name)!;

  describe("dar e tirar passos a um tipo", () => {
    it("dar passos cria os 4 por omissão e põe cada tarefa no passo do seu estado, sem mudar estados", async () => {
      const admin = await as("ADMINISTRADOR");
      const ids: Record<string, string> = {};
      for (const status of ["PENDING", "IN_PROGRESS", "DONE", "CANCELLED"]) {
        ids[status] = (await newTask(admin, { title: status, typeId: "VISITA", status })).id;
      }
      const other = await newTask(admin, { title: "Outra", typeId: "CHAMADA" });

      const type = await giveSteps(admin, "VISITA");
      expect(type.steps.map((s) => [s.name, s.category])).toEqual([
        ["Por fazer", "OPEN"],
        ["Em curso", "IN_PROGRESS"],
        ["Concluída", "DONE"],
        ["Cancelada", "CANCELLED"],
      ]);
      for (const [status, id] of Object.entries(ids)) {
        const t = await task(id);
        expect({ status: t.status, step: type.steps.find((s) => s.id === t.stepId)?.category }).toEqual({
          status,
          step: status === "PENDING" ? "OPEN" : status,
        });
      }
      expect((await task(other.id)).stepId).toBeNull();
      // Já tem passos: 409. Auditado.
      await api().post("/work-item-types/VISITA/workflow").set("Authorization", admin).expect(409);
      expect(await prisma().auditEvent.count({ where: { action: "work_item_type.workflow_added" } })).toBe(1);
    });

    it("tirar os passos deixa as tarefas sem passo, com o mesmo estado, e apaga o fluxo", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      const t = await newTask(admin, { title: "Em curso", typeId: "VISITA", stepId: stepNamed(type, "Em curso").id });

      const res = await api().delete("/work-item-types/VISITA/workflow").set("Authorization", admin).expect(200);
      expect(res.body).toMatchObject({ workflowId: null, steps: [] });
      expect(await task(t.id)).toMatchObject({ stepId: null, status: "IN_PROGRESS" });
      expect(await prisma().workflow.count({ where: { id: type.workflowId! } })).toBe(0);
      await api().delete("/work-item-types/VISITA/workflow").set("Authorization", admin).expect(400);
    });

    it("só o Administrador dá ou tira passos", async () => {
      const comercial = await as("COMERCIAL");
      await api().post("/work-item-types/VISITA/workflow").set("Authorization", comercial).expect(403);
      await api().delete("/work-item-types/VISITA/workflow").set("Authorization", comercial).expect(403);
      await api().post("/work-item-types/NAO_EXISTE/workflow").set("Authorization", await as("ADMINISTRADOR")).expect(404);
    });

    it("apagar um tipo sem tarefas apaga o fluxo e os campos dele", async () => {
      const admin = await as("ADMINISTRADOR");
      const created = (await api().post("/work-item-types").set("Authorization", admin).send({ name: "Entrega", icon: "truck", color: "orange" }).expect(201)).body;
      const type = await giveSteps(admin, created.id);
      await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "WORK_ITEM", scopeId: created.id, fieldLabel: "Morada", fieldType: "TEXT" }).expect(201);

      await api().delete(`/work-item-types/${created.id}`).set("Authorization", admin).expect(200);
      expect(await prisma().workflow.count({ where: { id: type.workflowId! } })).toBe(0);
      expect(await prisma().customField.count({ where: { scopeId: created.id } })).toBe(0);
    });
  });

  describe("tarefas num tipo com passos", () => {
    it("criar: sem passo vai para o primeiro «por fazer» (ou da categoria do estado); com passo, o estado é o dele", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");

      const a = await newTask(admin, { title: "A", typeId: "VISITA" });
      expect(a).toMatchObject({ status: "PENDING", stepId: stepNamed(type, "Por fazer").id, step: { name: "Por fazer", category: "OPEN" } });
      const b = await newTask(admin, { title: "B", typeId: "VISITA", status: "IN_PROGRESS" });
      expect(b).toMatchObject({ status: "IN_PROGRESS", stepId: stepNamed(type, "Em curso").id });
      const c = await newTask(admin, { title: "C", typeId: "VISITA", stepId: stepNamed(type, "Concluída").id });
      expect(c.status).toBe("DONE");

      // Passo de outro tipo, estado que não bate com o passo, passo num tipo sem passos: 400.
      const other = await giveSteps(admin, "CHAMADA");
      await api().post("/tasks").set("Authorization", admin).send({ title: "x", typeId: "VISITA", stepId: other.steps[0].id }).expect(400);
      await api().post("/tasks").set("Authorization", admin).send({ title: "x", typeId: "VISITA", stepId: stepNamed(type, "Em curso").id, status: "DONE" }).expect(400);
      await api().post("/tasks").set("Authorization", admin).send({ title: "x", typeId: "EMAIL", stepId: other.steps[0].id }).expect(400);
    });

    it("editar: o passo muda o estado; só o estado vai para o primeiro passo dessa categoria; editar o título não mexe", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      // Um segundo passo «por fazer», depois do primeiro.
      const waiting = (await api().post(`/workflows/${type.workflowId}/steps`).set("Authorization", admin).send({ name: "À espera", category: "OPEN" }).expect(201)).body;
      const t = await newTask(admin, { title: "T", typeId: "VISITA", stepId: waiting.id });
      expect(t.status).toBe("PENDING");

      await api().patch(`/tasks/${t.id}`).set("Authorization", admin).send({ title: "T2" }).expect(200);
      expect((await task(t.id)).stepId).toBe(waiting.id);
      // O formulário reenvia o mesmo estado: o passo atual (da mesma categoria) fica.
      await api().patch(`/tasks/${t.id}`).set("Authorization", admin).send({ status: "PENDING" }).expect(200);
      expect((await task(t.id)).stepId).toBe(waiting.id);

      await api().patch(`/tasks/${t.id}`).set("Authorization", admin).send({ stepId: stepNamed(type, "Em curso").id }).expect(200);
      expect(await task(t.id)).toMatchObject({ status: "IN_PROGRESS", stepId: stepNamed(type, "Em curso").id });

      await api().patch(`/tasks/${t.id}`).set("Authorization", admin).send({ status: "PENDING" }).expect(200);
      expect(await task(t.id)).toMatchObject({ status: "PENDING", stepId: stepNamed(type, "Por fazer").id });
    });

    it("sem passo da categoria pedida, o estado é recusado", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      await api().delete(`/workflow-steps/${stepNamed(type, "Cancelada").id}`).set("Authorization", admin).expect(204);
      const t = await newTask(admin, { title: "T", typeId: "VISITA" });
      const res = await api().patch(`/tasks/${t.id}`).set("Authorization", admin).send({ status: "CANCELLED" }).expect(400);
      expect(res.body.message).toContain("cancelada");
      expect((await task(t.id)).status).toBe("PENDING");
    });

    it("mudar de tipo: para um com passos entra no passo do estado; para um sem passos fica sem passo", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      const t = await newTask(admin, { title: "T", typeId: "CHAMADA", status: "IN_PROGRESS" });

      await api().patch(`/tasks/${t.id}`).set("Authorization", admin).send({ typeId: "VISITA" }).expect(200);
      expect(await task(t.id)).toMatchObject({ typeId: "VISITA", status: "IN_PROGRESS", stepId: stepNamed(type, "Em curso").id });

      await api().patch(`/tasks/${t.id}`).set("Authorization", admin).send({ typeId: "EMAIL" }).expect(200);
      expect(await task(t.id)).toMatchObject({ typeId: "EMAIL", status: "IN_PROGRESS", stepId: null });
    });

    it("concluir pelo passo regista na timeline como concluir pelo estado", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      const company = await prisma().company.create({ data: { name: "Acme" } });
      const t = await newTask(admin, { title: "Visita Acme", typeId: "VISITA", companyId: company.id });

      await api().patch(`/tasks/${t.id}`).set("Authorization", admin).send({ stepId: stepNamed(type, "Concluída").id }).expect(200);
      const events = await prisma().timelineEvent.findMany({ where: { entityId: { in: [t.id, company.id] } } });
      expect(events.map((e) => e.description)).toEqual(['Tarefa concluída: "Visita Acme".', 'Tarefa concluída: "Visita Acme".']);
    });

    it("a lead nova cria a tarefa no primeiro passo quando «Tarefa» tem passos", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "TAREFA");
      const lead = (await api().post("/leads").set("Authorization", admin).send({ name: "Lead com passos" }).expect(201)).body;
      const created = await prisma().workItem.findFirstOrThrow({ where: { leadId: lead.id } });
      expect(created).toMatchObject({ typeId: "TAREFA", status: "PENDING", stepId: stepNamed(type, "Por fazer").id });
    });

    it("a base de dados recusa um passo de outro fluxo, um estado que não bate e um tipo com passos sem passo", async () => {
      const admin = await as("ADMINISTRADOR");
      const visita = await giveSteps(admin, "VISITA");
      const chamada = await giveSteps(admin, "CHAMADA");
      const t = await newTask(admin, { title: "T", typeId: "VISITA" });

      await expect(prisma().workItem.update({ where: { id: t.id }, data: { stepId: chamada.steps[0].id } })).rejects.toThrow(/não é do fluxo/);
      await expect(prisma().workItem.update({ where: { id: t.id }, data: { status: "DONE" } })).rejects.toThrow(/não corresponde/);
      await expect(prisma().workItem.update({ where: { id: t.id }, data: { stepId: null } })).rejects.toThrow(/tem passos/);
      await expect(prisma().workItem.update({ where: { id: t.id }, data: { typeId: "EMAIL" } })).rejects.toThrow(/não é do fluxo/);
      expect(await task(t.id)).toMatchObject({ typeId: "VISITA", stepId: stepNamed(visita, "Por fazer").id, status: "PENDING" });
    });
  });

  describe("rotas genéricas de fluxos", () => {
    it("ler é para todos (com contagens); configurar é do Administrador e fica auditado", async () => {
      const admin = await as("ADMINISTRADOR");
      const reader = await as("LEITURA_APENAS");
      const type = await giveSteps(admin, "VISITA");
      await newTask(admin, { title: "T", typeId: "VISITA" });

      const wf = (await api().get(`/workflows/${type.workflowId}`).set("Authorization", reader).expect(200)).body;
      expect(wf).toMatchObject({ entityType: "WORK_ITEM", name: "Visita" });
      expect(wf.steps.map((s: { name: string; itemCount: number }) => [s.name, s.itemCount])).toEqual([
        ["Por fazer", 1],
        ["Em curso", 0],
        ["Concluída", 0],
        ["Cancelada", 0],
      ]);

      await api().post(`/workflows/${type.workflowId}/steps`).set("Authorization", reader).send({ name: "x" }).expect(403);
      await api().patch(`/workflow-steps/${type.steps[0].id}`).set("Authorization", reader).send({ name: "x" }).expect(403);
      await api().delete(`/workflow-steps/${type.steps[1].id}`).set("Authorization", reader).expect(403);

      await api().patch(`/workflow-steps/${type.steps[0].id}`).set("Authorization", admin).send({ name: "A fazer" }).expect(200);
      const reordered = (await api().patch(`/workflows/${type.workflowId}/steps/order`).set("Authorization", admin).send({ steps: [{ id: type.steps[1].id, order: 0 }, { id: type.steps[0].id, order: 1 }] }).expect(200)).body;
      expect(reordered.steps.map((s: Step) => s.name).slice(0, 2)).toEqual(["Em curso", "A fazer"]);
      expect(await prisma().auditEvent.count({ where: { action: { startsWith: "workflow." } } })).toBe(2);
    });

    it("passos de tarefas não têm resultado; nos negócios, o resultado só vai em passos concluídos", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      await api().post(`/workflows/${type.workflowId}/steps`).set("Authorization", admin).send({ name: "Ganha", category: "DONE", outcome: "WON" }).expect(400);
      await api().patch(`/workflow-steps/${stepNamed(type, "Concluída").id}`).set("Authorization", admin).send({ outcome: "WON" }).expect(400);

      const pipeline = (await api().post("/pipelines").set("Authorization", admin).send({ name: "Vendas" }).expect(201)).body;
      await api().post(`/workflows/${pipeline.id}/steps`).set("Authorization", admin).send({ name: "Ganho 2", category: "OPEN", outcome: "WON" }).expect(400);
      const won = (await api().post(`/workflows/${pipeline.id}/steps`).set("Authorization", admin).send({ name: "Ganho 2", category: "DONE", outcome: "WON" }).expect(201)).body;
      // Passar a aberta tira o resultado (só os concluídos o têm); a API dos negócios vê-a como aberta.
      await api().patch(`/workflow-steps/${won.id}`).set("Authorization", admin).send({ category: "IN_PROGRESS" }).expect(200);
      const stages = (await api().get(`/pipelines/${pipeline.id}`).set("Authorization", admin).expect(200)).body.stages;
      expect(stages.find((s: { id: string }) => s.id === won.id)).toMatchObject({ type: "OPEN", category: "IN_PROGRESS", outcome: null });
    });

    it("mudar a categoria de um passo muda o estado das tarefas que lá estão", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      const t = await newTask(admin, { title: "T", typeId: "VISITA", stepId: stepNamed(type, "Em curso").id });
      await api().patch(`/workflow-steps/${stepNamed(type, "Em curso").id}`).set("Authorization", admin).send({ category: "DONE" }).expect(200);
      expect((await task(t.id)).status).toBe("DONE");
    });

    it("apagar um passo com tarefas exige destino do mesmo fluxo; as tarefas ficam com o estado do destino", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      const other = await giveSteps(admin, "CHAMADA");
      const t = await newTask(admin, { title: "T", typeId: "VISITA", stepId: stepNamed(type, "Em curso").id });
      const doomed = stepNamed(type, "Em curso").id;

      const res = await api().delete(`/workflow-steps/${doomed}`).set("Authorization", admin).expect(400);
      expect(res.body.message).toContain("1 tarefa(s)");
      await api().delete(`/workflow-steps/${doomed}`).query({ moveTo: other.steps[0].id }).set("Authorization", admin).expect(400);
      await api().delete(`/workflow-steps/${doomed}`).query({ moveTo: doomed }).set("Authorization", admin).expect(400);
      await api().delete(`/workflow-steps/${doomed}`).query({ moveTo: stepNamed(type, "Concluída").id }).set("Authorization", admin).expect(204);
      expect(await task(t.id)).toMatchObject({ status: "DONE", stepId: stepNamed(type, "Concluída").id });
    });

    it("o último passo de um fluxo não se apaga (tarefas e negócios)", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      for (const s of type.steps.slice(1)) await api().delete(`/workflow-steps/${s.id}`).set("Authorization", admin).expect(204);
      await api().delete(`/workflow-steps/${type.steps[0].id}`).set("Authorization", admin).expect(400);

      const pipeline = (await api().post("/pipelines").set("Authorization", admin).send({ name: "Vendas" }).expect(201)).body;
      for (const s of pipeline.stages.slice(1)) await api().delete(`/stages/${s.id}`).set("Authorization", admin).expect(204);
      const res = await api().delete(`/stages/${pipeline.stages[0].id}`).set("Authorization", admin).expect(400);
      expect(res.body.message).toBe("Um funil tem de ter pelo menos uma fase");
    });

    it("um fluxo de um módulo desligado, ou de um tipo desconhecido, não existe (404)", async () => {
      const admin = await as("ADMINISTRADOR");
      const pipeline = (await api().post("/pipelines").set("Authorization", admin).send({ name: "Vendas" }).expect(201)).body;
      await api().patch("/modules/automations").set("Authorization", admin).send({ enabled: false }).expect(200);
      await api().patch("/modules/deals").set("Authorization", admin).send({ enabled: false }).expect(200);
      await api().get(`/workflows/${pipeline.id}`).set("Authorization", admin).expect(404);
      await api().post(`/workflows/${pipeline.id}/steps`).set("Authorization", admin).send({ name: "x" }).expect(404);
      await api().patch(`/workflow-steps/${pipeline.stages[0].id}`).set("Authorization", admin).send({ name: "x" }).expect(404);

      const foreign = await prisma().workflow.create({ data: { name: "Outro", entityType: "SERVICE", steps: { create: [{ name: "A", order: 0 }] } }, include: { steps: true } });
      await api().get(`/workflows/${foreign.id}`).set("Authorization", admin).expect(404);
      await api().delete(`/workflow-steps/${foreign.steps[0].id}`).set("Authorization", admin).expect(404);
    });
  });

  describe("quadro por passos", () => {
    it("conta por passo com os filtros da lista, e a coluna pagina pela ordem do prazo", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await giveSteps(admin, "VISITA");
      const open = stepNamed(type, "Por fazer").id;
      for (let i = 0; i < 5; i++) await newTask(admin, { title: `Visita ${i}`, typeId: "VISITA", dueDate: new Date(Date.UTC(2026, 0, 10 - i)).toISOString() });
      await newTask(admin, { title: "Montagem", typeId: "VISITA", stepId: stepNamed(type, "Em curso").id });
      await newTask(admin, { title: "Outra", typeId: "CHAMADA" });

      const board = (await api().get("/tasks/board").query({ typeId: "VISITA" }).set("Authorization", admin).expect(200)).body;
      expect(Object.fromEntries(board.map((b: { stepId: string; count: number }) => [b.stepId, b.count]))).toEqual({ [open]: 5, [stepNamed(type, "Em curso").id]: 1 });
      const searched = (await api().get("/tasks/board").query({ typeId: "VISITA", search: "montagem" }).set("Authorization", admin).expect(200)).body;
      expect(searched).toEqual([{ stepId: stepNamed(type, "Em curso").id, count: 1 }]);
      await api().get("/tasks/board").set("Authorization", admin).expect(400); // o tipo é obrigatório

      const page = (await api().get("/tasks").query({ typeId: "VISITA", stepId: open, limit: 3 }).set("Authorization", admin).expect(200)).body;
      expect(page.items.map((t: { title: string }) => t.title)).toEqual(["Visita 4", "Visita 3", "Visita 2"]);
      expect(page.nextCursor).toBeTruthy();
    });
  });

  describe("campos personalizados por tipo", () => {
    const define = (admin: string, body: Record<string, unknown>) => api().post("/custom-fields").set("Authorization", admin).send({ entityType: "WORK_ITEM", fieldType: "TEXT", ...body });

    it("campos de todas as tarefas e de um tipo; os valores só aceitam os que se aplicam ao tipo da tarefa", async () => {
      const admin = await as("ADMINISTRADOR");
      const all = (await define(admin, { fieldLabel: "Nota interna" }).expect(201)).body;
      const visit = (await define(admin, { fieldLabel: "Equipamento", scopeId: "VISITA" }).expect(201)).body;
      const call = (await define(admin, { fieldLabel: "Equipamento", scopeId: "CHAMADA" }).expect(201)).body; // mesmo nome noutro tipo
      expect([all.scopeId, visit.scopeId, call.scopeId]).toEqual(["", "VISITA", "CHAMADA"]);
      // Colisões: o mesmo nome no mesmo tipo, ou um de todas com o nome de um de um tipo (e o inverso).
      await define(admin, { fieldLabel: "Equipamento", scopeId: "VISITA" }).expect(400);
      await define(admin, { fieldLabel: "Equipamento" }).expect(400);
      await define(admin, { fieldLabel: "Nota interna", scopeId: "EMAIL" }).expect(400);
      // Âmbito inexistente, ou âmbito num tipo de registo que não os tem.
      await define(admin, { fieldLabel: "X", scopeId: "NAO_EXISTE" }).expect(400);
      await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "COMPANY", scopeId: "VISITA", fieldLabel: "X", fieldType: "TEXT" }).expect(400);

      const comercial = await as("COMERCIAL");
      const t = await newTask(comercial, { title: "Visita", typeId: "VISITA" });
      const save = (values: unknown[]) => api().post("/custom-fields/values").set("Authorization", comercial).send({ entityType: "WORK_ITEM", entityId: t.id, values });
      await save([{ customFieldId: call.id, value: "Telefone" }]).expect(400);
      const saved = (await save([{ customFieldId: all.id, value: "a" }, { customFieldId: visit.id, value: "Impressora" }]).expect(201)).body;
      expect(saved).toHaveLength(2);

      // Mudar de tipo esconde os valores dos campos do tipo antigo (ficam guardados); voltar mostra-os.
      await api().patch(`/tasks/${t.id}`).set("Authorization", comercial).send({ typeId: "CHAMADA" }).expect(200);
      const values = async () => (await api().get("/custom-fields/values").query({ entityType: "WORK_ITEM", entityId: t.id }).set("Authorization", comercial).expect(200)).body.map((v: { customFieldId: string }) => v.customFieldId);
      expect(await values()).toEqual([all.id]);
      await api().patch(`/tasks/${t.id}`).set("Authorization", comercial).send({ typeId: "VISITA" }).expect(200);
      expect((await values()).sort()).toEqual([all.id, visit.id].sort());

      // O âmbito não muda depois de criado.
      await api().patch(`/custom-fields/${visit.id}`).set("Authorization", admin).send({ scopeId: "EMAIL", fieldLabel: "Máquina" }).expect(200);
      expect(await prisma().customField.findUniqueOrThrow({ where: { id: visit.id } })).toMatchObject({ scopeId: "VISITA", fieldLabel: "Máquina" });
    });

    it("quem não escreve no trabalho do dia-a-dia não preenche; apagar a tarefa apaga os valores", async () => {
      const admin = await as("ADMINISTRADOR");
      const field = (await define(admin, { fieldLabel: "Nota" }).expect(201)).body;
      const t = await newTask(admin, { title: "T" });
      const reader = await as("LEITURA_APENAS");
      await api().post("/custom-fields/values").set("Authorization", reader).send({ entityType: "WORK_ITEM", entityId: t.id, values: [{ customFieldId: field.id, value: "x" }] }).expect(403);
      await api().post("/custom-fields/values").set("Authorization", admin).send({ entityType: "WORK_ITEM", entityId: t.id, values: [{ customFieldId: field.id, value: "x" }] }).expect(201);

      await api().delete(`/tasks/${t.id}`).set("Authorization", admin).expect(204);
      expect(await prisma().customFieldValue.count()).toBe(0);
    });
  });
});
