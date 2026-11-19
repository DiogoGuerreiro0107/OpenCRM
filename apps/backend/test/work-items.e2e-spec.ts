import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { SYSTEM_WORK_ITEM_TYPES, ensureSystemWorkItemTypes } from "../src/work-item-types/system-types";

// Fase 2a (docs/plano-fase-2-itens-de-trabalho.md): tipos de tarefa configuráveis, Task → WorkItem, estado cancelada.
describe("Itens de trabalho e tipos de tarefa (e2e)", () => {
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

  const as = async (role: Role) => bearerFor(app, await createUser(prisma(), role));
  const newType = async (auth: string, body: Record<string, unknown>) =>
    (await api().post("/work-item-types").set("Authorization", auth).send(body).expect(201)).body as { id: string; name: string };

  describe("tipos", () => {
    it("existem os tipos do sistema, pela ordem, com «Tarefa» por omissão", async () => {
      const auth = await as("LEITURA_APENAS");
      const res = await api().get("/work-item-types").set("Authorization", auth).expect(200);
      expect(res.body.map((t: { id: string }) => t.id)).toEqual(SYSTEM_WORK_ITEM_TYPES.map((t) => t.id));
      expect(res.body.filter((t: { isDefault: boolean }) => t.isDefault).map((t: { id: string }) => t.id)).toEqual(["TAREFA"]);
      expect(res.body.every((t: { isSystem: boolean; active: boolean }) => t.isSystem && t.active)).toBe(true);
    });

    it("só o Administrador configura; os outros papéis leem", async () => {
      const comercial = await as("COMERCIAL");
      await api().get("/work-item-types").set("Authorization", comercial).expect(200);
      await api().post("/work-item-types").set("Authorization", comercial).send({ name: "Instalação", icon: "wrench", color: "blue" }).expect(403);
      await api().patch("/work-item-types/VISITA").set("Authorization", comercial).send({ name: "Deslocação" }).expect(403);
      await api().delete("/work-item-types/OUTRO").set("Authorization", comercial).expect(403);
      await api().patch("/work-item-types/order").set("Authorization", comercial).send({ ids: ["TAREFA"] }).expect(403);
      await api().get("/work-item-types").expect(401);
    });

    it("cria com código a partir do nome, sem repetir, e o código não muda ao renomear", async () => {
      const admin = await as("ADMINISTRADOR");
      const a = await newType(admin, { name: "Instalação de rede", icon: "wrench", color: "blue" });
      const b = await newType(admin, { name: "Instalacao de Rede!", icon: "monitor", color: "teal" });
      expect([a.id, b.id]).toEqual(["INSTALACAO_DE_REDE", "INSTALACAO_DE_REDE_2"]);

      const renamed = await api().patch(`/work-item-types/${a.id}`).set("Authorization", admin).send({ name: "Montagem" }).expect(200);
      expect(renamed.body).toMatchObject({ id: "INSTALACAO_DE_REDE", name: "Montagem" });
      // Fica no fim da lista.
      const list = await api().get("/work-item-types").set("Authorization", admin).expect(200);
      expect(list.body.slice(-2).map((t: { id: string }) => t.id)).toEqual(["INSTALACAO_DE_REDE", "INSTALACAO_DE_REDE_2"]);
      // Auditado.
      expect(await prisma().auditEvent.count({ where: { action: { startsWith: "work_item_type." } } })).toBe(3);
    });

    it("valida ícone, cor e nome (listas fechadas)", async () => {
      const admin = await as("ADMINISTRADOR");
      await api().post("/work-item-types").set("Authorization", admin).send({ name: "X", icon: "<svg>", color: "blue" }).expect(400);
      await api().post("/work-item-types").set("Authorization", admin).send({ name: "X", icon: "phone", color: "#ff0000" }).expect(400);
      await api().post("/work-item-types").set("Authorization", admin).send({ name: "   ", icon: "phone", color: "blue" }).expect(400);
    });

    it("os do sistema não se apagam; o por omissão não se desativa; os outros desativam-se", async () => {
      const admin = await as("ADMINISTRADOR");
      const sys = await api().delete("/work-item-types/VISITA").set("Authorization", admin).expect(400);
      expect(sys.body.message).toMatch(/sistema/);
      await api().patch("/work-item-types/TAREFA").set("Authorization", admin).send({ active: false }).expect(400);
      await api().patch("/work-item-types/VISITA").set("Authorization", admin).send({ active: false, name: "Deslocação" }).expect(200);

      const active = await api().get("/work-item-types?active=true").set("Authorization", admin).expect(200);
      expect(active.body.map((t: { id: string }) => t.id)).not.toContain("VISITA");
      // O arranque repõe os que faltem, mas não altera um tipo de sistema existente.
      await ensureSystemWorkItemTypes(prisma());
      const visita = await prisma().workItemType.findUniqueOrThrow({ where: { id: "VISITA" } });
      expect(visita).toMatchObject({ active: false, name: "Deslocação" });
    });

    it("um tipo com tarefas não se apaga (desativa-se); sem tarefas, apaga-se", async () => {
      const admin = await as("ADMINISTRADOR");
      const type = await newType(admin, { name: "Entrega", icon: "truck", color: "orange" });
      const task = await api().post("/tasks").set("Authorization", admin).send({ title: "Levar toner", typeId: type.id }).expect(201);
      const blocked = await api().delete(`/work-item-types/${type.id}`).set("Authorization", admin).expect(409);
      expect(blocked.body.message).toMatch(/1 tarefa/);

      const list = await api().get("/work-item-types").set("Authorization", admin).expect(200);
      expect(list.body.find((t: { id: string }) => t.id === type.id).itemCount).toBe(1);

      await api().delete(`/tasks/${task.body.id}`).set("Authorization", admin).expect(204);
      await api().delete(`/work-item-types/${type.id}`).set("Authorization", admin).expect(200);
      expect(await prisma().workItemType.count({ where: { id: type.id } })).toBe(0);
    });

    it("reordenar exige todos os tipos, uma vez cada", async () => {
      const admin = await as("ADMINISTRADOR");
      const ids = SYSTEM_WORK_ITEM_TYPES.map((t) => t.id);
      await api().patch("/work-item-types/order").set("Authorization", admin).send({ ids: ids.slice(1) }).expect(400);
      await api().patch("/work-item-types/order").set("Authorization", admin).send({ ids: [...ids, "TAREFA"] }).expect(400);
      await api().patch("/work-item-types/order").set("Authorization", admin).send({ ids: [...ids.slice(1), "NAO_EXISTE"] }).expect(400);
      const reversed = [...ids].reverse();
      const res = await api().patch("/work-item-types/order").set("Authorization", admin).send({ ids: reversed }).expect(200);
      expect(res.body.map((t: { id: string }) => t.id)).toEqual(reversed);
    });
  });

  describe("tarefas com tipo", () => {
    it("sem tipo ficam «Tarefa»; com tipo devolvem o tipo; filtra-se por tipo", async () => {
      const auth = await as("COMERCIAL");
      const plain = await api().post("/tasks").set("Authorization", auth).send({ title: "Ligar" }).expect(201);
      expect(plain.body.type).toEqual({ id: "TAREFA", name: "Tarefa", icon: "check-square", color: "slate" });
      const visit = await api().post("/tasks").set("Authorization", auth).send({ title: "Visitar", typeId: "VISITA" }).expect(201);
      expect(visit.body).toMatchObject({ typeId: "VISITA", type: { name: "Visita" } });

      const filtered = await api().get("/tasks?typeId=VISITA").set("Authorization", auth).expect(200);
      expect(filtered.body.items.map((t: { id: string }) => t.id)).toEqual([visit.body.id]);
      // A tarefa automática da lead também fica com o tipo por omissão.
      await api().post("/leads").set("Authorization", auth).send({ name: "Maria" }).expect(201);
      expect(await prisma().workItem.count({ where: { typeId: "TAREFA", leadId: { not: null } } })).toBe(1);
    });

    it("tipo desconhecido ou desativado é recusado ao criar e ao mudar; mantém-se em tarefas que já o têm", async () => {
      const admin = await as("ADMINISTRADOR");
      await api().post("/tasks").set("Authorization", admin).send({ title: "X", typeId: "NAO_EXISTE" }).expect(400);
      const task = await api().post("/tasks").set("Authorization", admin).send({ title: "Visitar", typeId: "VISITA" }).expect(201);
      const other = await api().post("/tasks").set("Authorization", admin).send({ title: "Outra" }).expect(201);
      await api().patch("/work-item-types/VISITA").set("Authorization", admin).send({ active: false }).expect(200);

      const refused = await api().post("/tasks").set("Authorization", admin).send({ title: "Y", typeId: "VISITA" }).expect(400);
      expect(refused.body.message).toMatch(/desativado/);
      await api().patch(`/tasks/${other.body.id}`).set("Authorization", admin).send({ typeId: "VISITA" }).expect(400);
      // Editar a que já é Visita (mesmo reenviando o tipo) funciona.
      await api().patch(`/tasks/${task.body.id}`).set("Authorization", admin).send({ title: "Visitar cliente", typeId: "VISITA" }).expect(200);
    });

    it("cancelada fica fora de atrasadas, de hoje e do dashboard, e regista «cancelada» na timeline", async () => {
      const user = await createUser(prisma(), "COMERCIAL");
      const auth = await bearerFor(app, user);
      const company = await prisma().company.create({ data: { name: "Acme" } });
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
      const late = await api().post("/tasks").set("Authorization", auth).send({ title: "Atrasada", dueDate: yesterday, companyId: company.id }).expect(201);
      const forToday = await api().post("/tasks").set("Authorization", auth).send({ title: "Hoje", dueDate: today }).expect(201);

      const ids = async (q: string) => (await api().get(`/tasks?${q}`).set("Authorization", auth).expect(200)).body.items.map((t: { id: string }) => t.id);
      expect(await ids("overdue=true")).toEqual([late.body.id]);
      expect(await ids("dueToday=true")).toEqual([forToday.body.id]);

      await api().patch(`/tasks/${late.body.id}`).set("Authorization", auth).send({ status: "CANCELLED" }).expect(200);
      await api().patch(`/tasks/${forToday.body.id}`).set("Authorization", auth).send({ status: "CANCELLED" }).expect(200);
      expect(await ids("overdue=true")).toEqual([]);
      expect(await ids("dueToday=true")).toEqual([]);
      const dash = await api().get("/dashboard/summary").set("Authorization", auth).expect(200);
      expect(dash.body).toMatchObject({ tasksToday: 0, tasksOverdue: 0 });

      const events = await prisma().timelineEvent.findMany({ where: { entityId: { in: [late.body.id, company.id] } }, orderBy: { entityType: "asc" } });
      expect(events.map((e) => [e.entityType, e.description])).toEqual([
        ["COMPANY", 'Tarefa cancelada: "Atrasada".'],
        ["TASK", 'Tarefa cancelada: "Atrasada".'],
      ]);
      // Reabrir e concluir regista «concluída»; voltar a gravar o mesmo estado não repete o evento.
      await api().patch(`/tasks/${late.body.id}`).set("Authorization", auth).send({ status: "PENDING" }).expect(200);
      await api().patch(`/tasks/${late.body.id}`).set("Authorization", auth).send({ status: "DONE" }).expect(200);
      await api().patch(`/tasks/${late.body.id}`).set("Authorization", auth).send({ status: "DONE" }).expect(200);
      const taskEvents = await prisma().timelineEvent.findMany({ where: { entityId: late.body.id }, orderBy: { createdAt: "asc" } });
      expect(taskEvents.map((e) => e.description)).toEqual(['Tarefa cancelada: "Atrasada".', 'Tarefa concluída: "Atrasada".']);
    });

    it("os triggers continuam a manter a pesquisa e a ordem depois de renomear a tabela", async () => {
      const auth = await as("COMERCIAL");
      await api().post("/tasks").set("Authorization", auth).send({ title: "Orçamento para a Gráfica" }).expect(201);
      const res = await api().get("/tasks?search=grafica").set("Authorization", auth).expect(200);
      expect(res.body.items).toHaveLength(1);
      const row = await prisma().workItem.findFirstOrThrow({ omit: { searchText: false, dueSort: false } });
      expect(row.searchText).toBe("orcamento para a grafica");
      expect(row.dueSort.toISOString()).toBe("9999-12-31T00:00:00.000Z");
    });

    it("o calendário filtra por tipo", async () => {
      const auth = await as("COMERCIAL");
      await api().post("/tasks").set("Authorization", auth).send({ title: "Visita", typeId: "VISITA", dueDate: "2026-11-10T10:00:00Z" }).expect(201);
      await api().post("/tasks").set("Authorization", auth).send({ title: "Tarefa", dueDate: "2026-11-10T11:00:00Z" }).expect(201);
      const res = await api().get("/tasks/calendar?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z&typeId=VISITA").set("Authorization", auth).expect(200);
      expect(res.body.items.map((t: { title: string }) => t.title)).toEqual(["Visita"]);
      expect(res.body.countsByDay).toEqual({ "2026-11-10": 1 });
    });
  });
});
