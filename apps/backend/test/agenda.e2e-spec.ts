import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

// Fase 2d (docs/plano-fase-2-itens-de-trabalho.md): horário marcado, momento na agenda e a agenda com várias fontes.
describe("Agenda (e2e)", () => {
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

  const as = async (role: Role, name?: string) => {
    const user = await createUser(prisma(), role, name);
    return { user, auth: await bearerFor(app, user) };
  };
  const newTask = async (auth: string, body: Record<string, unknown>) =>
    (await api().post("/tasks").set("Authorization", auth).send(body).expect(201)).body as { id: string; scheduledStart: string | null; scheduledEnd: string | null };
  // Coluna interna (fica de fora das respostas e do Prisma por omissão): lê-se diretamente.
  const agendaAt = async (id: string) =>
    (await prisma().$queryRaw<Array<{ agendaAt: Date | null }>>`SELECT "agendaAt" FROM "WorkItem" WHERE id = ${id}`)[0].agendaAt;
  const agenda = (auth: string, query: Record<string, string | number>) => api().get("/agenda").query(query).set("Authorization", auth);
  const MARCH = { from: "2026-03-01T00:00:00.000Z", to: "2026-03-31T23:59:59.999Z", tz: "UTC" };

  describe("horário marcado nas tarefas", () => {
    it("grava, devolve e limpa; o momento na agenda é o início marcado, senão o prazo", async () => {
      const { auth } = await as("COMERCIAL");
      const t = await newTask(auth, { title: "Visita", dueDate: "2026-03-20T18:00:00.000Z", scheduledStart: "2026-03-18T09:00:00.000Z", scheduledEnd: "2026-03-18T10:30:00.000Z" });
      expect([t.scheduledStart, t.scheduledEnd]).toEqual(["2026-03-18T09:00:00.000Z", "2026-03-18T10:30:00.000Z"]);
      expect((await agendaAt(t.id))?.toISOString()).toBe("2026-03-18T09:00:00.000Z");
      // A coluna interna não sai nas respostas.
      expect(Object.keys((await api().get(`/tasks/${t.id}`).set("Authorization", auth).expect(200)).body)).not.toContain("agendaAt");

      await api().patch(`/tasks/${t.id}`).set("Authorization", auth).send({ scheduledStart: null, scheduledEnd: null }).expect(200);
      expect((await agendaAt(t.id))?.toISOString()).toBe("2026-03-20T18:00:00.000Z");
      await api().patch(`/tasks/${t.id}`).set("Authorization", auth).send({ dueDate: null }).expect(200);
      expect(await agendaAt(t.id)).toBeNull();
    });

    it("fim sem início ou antes do início é recusado (400), também ao editar só um dos dois, e na base de dados", async () => {
      const { auth } = await as("COMERCIAL");
      await api().post("/tasks").set("Authorization", auth).send({ title: "x", scheduledEnd: "2026-03-18T10:00:00.000Z" }).expect(400);
      await api().post("/tasks").set("Authorization", auth).send({ title: "x", scheduledStart: "2026-03-18T10:00:00.000Z", scheduledEnd: "2026-03-18T09:00:00.000Z" }).expect(400);
      await api().post("/tasks").set("Authorization", auth).send({ title: "x", scheduledStart: "não é data" }).expect(400);
      const t = await newTask(auth, { title: "ok", scheduledStart: "2026-03-18T09:00:00.000Z", scheduledEnd: "2026-03-18T10:00:00.000Z" });
      await api().patch(`/tasks/${t.id}`).set("Authorization", auth).send({ scheduledStart: "2026-03-18T11:00:00.000Z" }).expect(400);
      await api().patch(`/tasks/${t.id}`).set("Authorization", auth).send({ scheduledStart: null }).expect(400);
      await expect(prisma().workItem.update({ where: { id: t.id }, data: { scheduledEnd: new Date("2026-03-17T00:00:00.000Z") } })).rejects.toThrow(/WorkItem_horario_valido/);
    });

    it("o calendário das tarefas usa o horário marcado (uma visita marcada sem prazo aparece)", async () => {
      const { auth } = await as("COMERCIAL");
      const t = await newTask(auth, { title: "Visita marcada", scheduledStart: "2026-03-18T09:00:00.000Z" });
      const res = await api().get("/tasks/calendar").query(MARCH).set("Authorization", auth).expect(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([t.id]);
      expect(res.body.countsByDay).toEqual({ "2026-03-18": 1 });
    });
  });

  describe("GET /agenda", () => {
    it("junta tarefas e próxima ação das leads em aberto, com o dia, o tipo e o responsável", async () => {
      const { user, auth } = await as("COMERCIAL", "Rita");
      const visit = await newTask(auth, { title: "Visita Acme", typeId: "VISITA", scheduledStart: "2026-03-18T09:00:00.000Z", scheduledEnd: "2026-03-18T10:00:00.000Z" });
      const call = await newTask(auth, { title: "Ligar", dueDate: "2026-03-18T15:00:00.000Z" });
      const open = await prisma().lead.create({ data: { name: "Ana", companyName: "Beta Lda", nextActionAt: new Date("2026-03-18T00:00:00.000Z"), responsavelId: user.id } });
      await prisma().lead.create({ data: { name: "Fechada", status: "CONVERTIDO", nextActionAt: new Date("2026-03-18T00:00:00.000Z") } });
      await prisma().lead.create({ data: { name: "Fora", nextActionAt: new Date("2026-04-02T00:00:00.000Z") } });
      // Tarefas da criação das leads (prazo amanhã) não interessam aqui: só março.

      const res = (await agenda(auth, MARCH).expect(200)).body;
      expect(res.sources).toEqual(["WORK_ITEM", "LEAD_NEXT_ACTION"]);
      expect(res.countsByDay).toEqual({ "2026-03-18": 3 });
      expect(res.entries.map((e: { source: string; id: string; kind: string }) => [e.source, e.id, e.kind])).toEqual([
        ["LEAD_NEXT_ACTION", open.id, "date"], // dia inteiro primeiro
        ["WORK_ITEM", visit.id, "scheduled"],
        ["WORK_ITEM", call.id, "due"],
      ]);
      expect(res.entries[0]).toMatchObject({ title: "Ana (Beta Lda)", day: "2026-03-18", assignee: { id: user.id, name: "Rita" } });
      expect(res.entries[1]).toMatchObject({ day: "2026-03-18", start: "2026-03-18T09:00:00.000Z", end: "2026-03-18T10:00:00.000Z", type: { id: "VISITA" }, closed: false });
    });

    it("o dia conta-se no fuso pedido (as leads, que só têm data, não mudam de dia)", async () => {
      const { auth } = await as("COMERCIAL");
      await newTask(auth, { title: "Tarde", dueDate: "2026-03-10T23:30:00.000Z" });
      await prisma().lead.create({ data: { name: "Lead", nextActionAt: new Date("2026-03-10T00:00:00.000Z") } });
      const utc = (await agenda(auth, MARCH).expect(200)).body;
      const tokyo = (await agenda(auth, { ...MARCH, tz: "Asia/Tokyo" }).expect(200)).body;
      expect(utc.countsByDay).toEqual({ "2026-03-10": 2 });
      expect(tokyo.countsByDay).toEqual({ "2026-03-10": 1, "2026-03-11": 1 });
      expect(tokyo.entries.find((e: { source: string }) => e.source === "LEAD_NEXT_ACTION").day).toBe("2026-03-10");
    });

    it("perDay limita as entradas de cada dia e as contagens dizem quantas há", async () => {
      const { auth } = await as("COMERCIAL");
      for (let i = 0; i < 5; i++) await newTask(auth, { title: `T${i}`, dueDate: `2026-03-05T0${i}:00:00.000Z` });
      const res = (await agenda(auth, { ...MARCH, perDay: 2 }).expect(200)).body;
      expect(res.entries.map((e: { title: string }) => e.title)).toEqual(["T0", "T1"]);
      expect(res.countsByDay).toEqual({ "2026-03-05": 5 });
    });

    it("ao juntar as fontes, cada dia fica com perDay entradas (dia inteiro primeiro, mesmo com tarefas mais cedo)", async () => {
      const { auth } = await as("COMERCIAL");
      // Em Tóquio, estas tarefas caem a 11 de março de madrugada, antes da meia-noite UTC em que está a data das leads.
      await newTask(auth, { title: "T1", dueDate: "2026-03-10T16:00:00.000Z" });
      await newTask(auth, { title: "T2", dueDate: "2026-03-10T17:00:00.000Z" });
      await prisma().lead.create({ data: { name: "L1", nextActionAt: new Date("2026-03-11T00:00:00.000Z") } });
      await prisma().lead.create({ data: { name: "L2", nextActionAt: new Date("2026-03-11T00:00:00.000Z") } });
      const res = (await agenda(auth, { ...MARCH, tz: "Asia/Tokyo", perDay: 3 }).expect(200)).body;
      expect(res.countsByDay).toEqual({ "2026-03-11": 4 });
      expect(res.entries.map((e: { title: string }) => e.title)).toEqual(["L1", "L2", "T1"]);
    });

    it("filtros: responsável nas duas fontes; tipo só nas tarefas (as leads saem); fontes escolhidas", async () => {
      const rita = await as("COMERCIAL", "Rita");
      const rui = await as("TECNICO", "Rui");
      await newTask(rita.auth, { title: "Da Rita", typeId: "VISITA", dueDate: "2026-03-05T10:00:00.000Z" });
      await newTask(rui.auth, { title: "Do Rui", dueDate: "2026-03-05T11:00:00.000Z" });
      await prisma().lead.create({ data: { name: "Lead da Rita", nextActionAt: new Date("2026-03-05T00:00:00.000Z"), responsavelId: rita.user.id } });
      await prisma().lead.create({ data: { name: "Lead do Rui", nextActionAt: new Date("2026-03-05T00:00:00.000Z"), responsavelId: rui.user.id } });
      const titles = async (q: Record<string, string>) => (await agenda(rita.auth, { ...MARCH, ...q }).expect(200)).body.entries.map((e: { title: string }) => e.title);

      expect(await titles({ assigneeId: rui.user.id })).toEqual(["Lead do Rui", "Do Rui"]);
      expect(await titles({ typeId: "VISITA" })).toEqual(["Da Rita"]);
      expect(await titles({ sources: "LEAD_NEXT_ACTION" })).toEqual(["Lead da Rita", "Lead do Rui"]);
      expect(await titles({ sources: "WORK_ITEM", assigneeId: rita.user.id })).toEqual(["Da Rita"]);
    });

    it("com o módulo de leads desligado, a fonte das leads não entra", async () => {
      const admin = await as("ADMINISTRADOR");
      await prisma().lead.create({ data: { name: "Lead", nextActionAt: new Date("2026-03-05T00:00:00.000Z") } });
      await api().patch("/modules/leads").set("Authorization", admin.auth).send({ enabled: false }).expect(200);
      const res = (await agenda(admin.auth, MARCH).expect(200)).body;
      expect(res.sources).toEqual(["WORK_ITEM"]);
      expect(res.entries).toEqual([]);
      await api().patch("/modules/leads").set("Authorization", admin.auth).send({ enabled: true }).expect(200);
    });

    it("tarefas concluídas e canceladas aparecem marcadas como fechadas", async () => {
      const { auth } = await as("COMERCIAL");
      const t = await newTask(auth, { title: "Feita", dueDate: "2026-03-05T10:00:00.000Z" });
      await api().patch(`/tasks/${t.id}`).set("Authorization", auth).send({ status: "CANCELLED" }).expect(200);
      const [entry] = (await agenda(auth, MARCH).expect(200)).body.entries;
      expect(entry).toMatchObject({ id: t.id, closed: true, cancelled: true });
    });

    it("recusa intervalo grande ou invertido, fuso, perDay e fontes inválidos; sem sessão dá 401", async () => {
      const { auth } = await as("LEITURA_APENAS");
      await agenda(auth, MARCH).expect(200); // leitura para todos
      await agenda(auth, { ...MARCH, to: "2026-05-15T00:00:00.000Z" }).expect(400);
      await agenda(auth, { ...MARCH, from: "2026-04-01T00:00:00.000Z" }).expect(400);
      await agenda(auth, { ...MARCH, tz: "Europa/Lisboa" }).expect(400);
      await agenda(auth, { ...MARCH, tz: "UTC'; DROP TABLE \"WorkItem\";--" }).expect(400);
      await agenda(auth, { ...MARCH, perDay: 0 }).expect(400);
      await agenda(auth, { ...MARCH, perDay: 51 }).expect(400);
      await agenda(auth, { ...MARCH, sources: "WORK_ITEM,FERIAS" }).expect(400);
      await api().get("/agenda").query({ to: MARCH.to }).set("Authorization", auth).expect(400);
      await api().get("/agenda").query(MARCH).expect(401);
    });
  });
});
