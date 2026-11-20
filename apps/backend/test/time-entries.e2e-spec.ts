import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

// Fase 4b (docs/plano-fase-4-assistencias.md): cronómetro e registo de tempo nos itens de trabalho.
describe("Registo de tempo (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let rui: string;
  let ruiUser: { id: string };
  let ana: string;
  let anaUser: { id: string };

  const HOUR = 3600_000;
  const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    ruiUser = await createUser(prisma(), "TECNICO", "Rui Técnico");
    rui = await bearerFor(app, ruiUser as never);
    anaUser = await createUser(prisma(), "COMERCIAL", "Ana Comercial");
    ana = await bearerFor(app, anaUser as never);
  });

  afterAll(async () => {
    await app.close();
  });

  const newTask = async (title = "Tarefa", auth = rui) => (await api().post("/tasks").set("Authorization", auth).send({ title }).expect(201)).body as { id: string };
  const start = (workItemId: string, auth = rui) => api().post("/time-entries/start").set("Authorization", auth).send({ workItemId });
  const stop = (auth = rui, body: Record<string, unknown> = {}) => api().post("/time-entries/stop").set("Authorization", auth).send(body);
  const active = async (auth = rui) => (await api().get("/time-entries/active").set("Authorization", auth).expect(200)).body;
  const manual = (body: Record<string, unknown>, auth = rui) => api().post("/time-entries").set("Authorization", auth).send(body);
  const running = () => prisma().timeEntry.findMany({ where: { endedAt: null } });

  it("iniciar, parar e mudar de item: o anterior para; o servidor guarda as horas", async () => {
    const sc = (await api().post("/service-cases").set("Authorization", rui).send({ reportedProblem: "Não liga" }).expect(201)).body;
    const other = await newTask("Ligar ao cliente");

    const first = (await start(sc.workItemId).expect(201)).body;
    expect(first).toMatchObject({ stopped: null, entry: { workItemId: sc.workItemId, running: true, manual: false, user: { id: ruiUser.id } } });
    expect(first.entry.runningUserId).toBeUndefined();
    expect((await active()).entry).toMatchObject({ id: first.entry.id, forgotten: false, workItem: { id: sc.workItemId, serviceCaseCode: "AS-0001" } });

    // No mesmo item: o mesmo registo, sem mudar nada.
    expect((await start(sc.workItemId).expect(201)).body.entry.id).toBe(first.entry.id);

    const second = (await start(other.id).expect(201)).body;
    expect(second.stopped).toMatchObject({ id: first.entry.id, running: false, workItem: { id: sc.workItemId } });
    expect((await active()).entry.id).toBe(second.entry.id);
    expect(await running()).toHaveLength(1);

    const stopped = (await stop(rui, { note: "Feito" }).expect(200)).body;
    expect(stopped).toMatchObject({ id: second.entry.id, running: false, note: "Feito" });
    expect((await active()).entry).toBeNull();
    await stop().expect(404);
    await start("nao-existe").expect(404);
  });

  it("um só a correr por pessoa: a base de dados não deixa, também em pedidos simultâneos", async () => {
    const items = await Promise.all(Array.from({ length: 5 }, (_, i) => newTask(`T${i}`)));
    const results = await Promise.all(items.map((t) => start(t.id)));
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect((await running()).filter((e) => e.userId === ruiUser.id)).toHaveLength(1);

    const t = items[0];
    const now = new Date();
    // Diretamente na base de dados: segundo a correr, a correr sem marca, marca de outro, fim antes do início.
    await expect(prisma().timeEntry.create({ data: { workItemId: t.id, userId: ruiUser.id, startedAt: now, runningUserId: ruiUser.id } })).rejects.toThrow();
    await expect(prisma().timeEntry.create({ data: { workItemId: t.id, userId: anaUser.id, startedAt: now } })).rejects.toThrow();
    await expect(prisma().timeEntry.create({ data: { workItemId: t.id, userId: anaUser.id, startedAt: now, runningUserId: ruiUser.id } })).rejects.toThrow();
    await expect(prisma().timeEntry.create({ data: { workItemId: t.id, userId: anaUser.id, startedAt: now, endedAt: new Date(now.getTime() - 1000) } })).rejects.toThrow();
    // Outra pessoa pode ter o seu.
    await start(t.id, ana).expect(201);
  });

  it("tarefa fechada: não inicia; fechar para os cronómetros que correm nela (de todos)", async () => {
    const t = await newTask();
    await start(t.id).expect(201);
    await start(t.id, ana).expect(201);
    const elsewhere = await newTask("Outra");
    await start(elsewhere.id, admin).expect(201);

    await api().patch(`/tasks/${t.id}`).set("Authorization", rui).send({ status: "DONE" }).expect(200);
    expect((await running()).map((e) => e.workItemId)).toEqual([elsewhere.id]);
    expect((await active()).entry).toBeNull();
    await start(t.id).expect(400);
  });

  it("registo manual: no passado, fim depois do início, até 24 h, sem sobreposições", async () => {
    const t = await newTask();
    const created = (await manual({ workItemId: t.id, startedAt: ago(3), endedAt: ago(2), note: " Visita ", billable: false }).expect(201)).body;
    expect(created).toMatchObject({ manual: true, running: false, note: "Visita", billable: false, durationSeconds: 3600 });

    await manual({ workItemId: t.id, startedAt: ago(2), endedAt: ago(3) }).expect(400);
    const same = ago(2);
    await manual({ workItemId: t.id, startedAt: same, endedAt: same }).expect(400);
    await manual({ workItemId: t.id, startedAt: ago(1), endedAt: ago(-1) }).expect(400);
    await manual({ workItemId: t.id, startedAt: ago(30), endedAt: ago(5) }).expect(400);
    await manual({ workItemId: "nao-existe", startedAt: ago(3), endedAt: ago(2) }).expect(404);

    // Sobreposições com os registos da mesma pessoa (encostado não conta); outra pessoa pode.
    await manual({ workItemId: t.id, startedAt: ago(2.5), endedAt: ago(1.5) }).expect(409);
    await manual({ workItemId: t.id, startedAt: ago(4), endedAt: ago(1) }).expect(409);
    await manual({ workItemId: t.id, startedAt: ago(2), endedAt: ago(1.5) }).expect(201);
    await manual({ workItemId: t.id, startedAt: ago(2.5), endedAt: ago(1.5) }, ana).expect(201);

    // O que está a correr conta até agora.
    await start(t.id).expect(201);
    const startedAt = new Date((await active()).entry.startedAt).getTime();
    await manual({ workItemId: t.id, startedAt: new Date(startedAt - 60_000).toISOString(), endedAt: new Date(startedAt + 1000).toISOString() }).expect(409);
    // Num item fechado também se regista à mão.
    const done = await newTask("Fechada");
    await api().patch(`/tasks/${done.id}`).set("Authorization", rui).send({ status: "DONE" }).expect(200);
    await manual({ workItemId: done.id, startedAt: ago(6), endedAt: ago(5) }).expect(201);
  });

  it("editar: nota livre; horas só com motivo (registo, timeline e auditoria); sem sobreposições", async () => {
    const t = await newTask();
    const a = (await manual({ workItemId: t.id, startedAt: ago(4), endedAt: ago(3) }).expect(201)).body;
    await manual({ workItemId: t.id, startedAt: ago(2), endedAt: ago(1) }).expect(201);
    const patch = (body: Record<string, unknown>, auth = rui) => api().patch(`/time-entries/${a.id}`).set("Authorization", auth).send(body);

    expect((await patch({ note: "Diagnóstico", billable: false }).expect(200)).body).toMatchObject({ note: "Diagnóstico", billable: false, editReason: null });
    await patch({ endedAt: ago(3.5) }).expect(400);
    await patch({ endedAt: ago(3.5), reason: "   " }).expect(400);
    // Igual ao que já está não é mudança.
    await patch({ startedAt: a.startedAt }).expect(200);

    const edited = (await patch({ endedAt: ago(3.5), reason: "Saí mais cedo", tz: "Europe/Lisbon" }).expect(200)).body;
    expect(edited).toMatchObject({ editReason: "Saí mais cedo", editedBy: { id: ruiUser.id }, durationSeconds: 1800 });
    const events = await prisma().timelineEvent.findMany({ where: { entityType: "TASK", entityId: t.id } });
    expect(events).toHaveLength(1);
    expect(events[0].description).toMatch(/^Tempo acertado \(Rui Técnico\): \d\d\/\d\d \d\d:\d\d–\d\d:\d\d → \d\d\/\d\d \d\d:\d\d–\d\d:\d\d\. Motivo: Saí mais cedo$/);
    expect(await prisma().auditEvent.count({ where: { action: "time_entry.updated", targetId: a.id } })).toBeGreaterThan(0);

    await patch({ endedAt: ago(1.5), reason: "x" }).expect(409);
    await patch({ startedAt: ago(30), reason: "x" }).expect(400);

    // A correr: acerta-se o início (com motivo), mas para-se com «parar».
    const other = await newTask("Outra");
    const run = (await start(other.id).expect(201)).body.entry;
    await api().patch(`/time-entries/${run.id}`).set("Authorization", rui).send({ endedAt: new Date().toISOString(), reason: "x" }).expect(400);
    await api().patch(`/time-entries/${run.id}`).set("Authorization", rui).send({ startedAt: ago(0.5), reason: "Comecei antes" }).expect(200);
    await api().patch(`/time-entries/${run.id}`).set("Authorization", rui).send({ startedAt: ago(-1), reason: "x" }).expect(400);
  });

  it("apagar pede motivo e fica na timeline e na auditoria", async () => {
    const t = await newTask();
    const a = (await manual({ workItemId: t.id, startedAt: ago(2), endedAt: ago(1) }).expect(201)).body;
    await api().delete(`/time-entries/${a.id}`).set("Authorization", rui).send({}).expect(400);
    await api().delete(`/time-entries/${a.id}`).set("Authorization", rui).send({ reason: "Duplicado" }).expect(204);
    expect(await prisma().timeEntry.count()).toBe(0);
    const [event] = await prisma().timelineEvent.findMany({ where: { entityType: "TASK", entityId: t.id } });
    expect(event.description).toMatch(/^Registo de tempo apagado \(Rui Técnico, .+, 1h00\)\. Motivo: Duplicado$/);
    expect(await prisma().auditEvent.count({ where: { action: "time_entry.deleted", targetId: a.id } })).toBe(1);
    await api().delete(`/time-entries/${a.id}`).set("Authorization", rui).send({ reason: "x" }).expect(404);

    // Apagar o que está a correr liberta o cronómetro.
    const run = (await start(t.id).expect(201)).body.entry;
    await api().delete(`/time-entries/${run.id}`).set("Authorization", rui).send({ reason: "Engano" }).expect(204);
    await start(t.id).expect(201);
  });

  it("permissões: cada um os seus; o Administrador todos; Leitura apenas só consulta", async () => {
    const t = await newTask();
    const a = (await manual({ workItemId: t.id, startedAt: ago(2), endedAt: ago(1) }).expect(201)).body;
    await api().patch(`/time-entries/${a.id}`).set("Authorization", ana).send({ note: "x" }).expect(403);
    await api().delete(`/time-entries/${a.id}`).set("Authorization", ana).send({ reason: "x" }).expect(403);
    const byAdmin = (await api().patch(`/time-entries/${a.id}`).set("Authorization", admin).send({ startedAt: ago(1.5), reason: "Corrigido pela gestão" }).expect(200)).body;
    expect(byAdmin.editedBy.name).not.toBe("Rui Técnico");

    const reader = await bearerFor(app, await createUser(prisma(), "LEITURA_APENAS"));
    await start(t.id, reader).expect(403);
    await manual({ workItemId: t.id, startedAt: ago(5), endedAt: ago(4) }, reader).expect(403);
    await api().get(`/time-entries?workItemId=${t.id}`).set("Authorization", reader).expect(200);
    await api().get(`/time-entries/summary?workItemId=${t.id}`).set("Authorization", reader).expect(200);
    await api().get("/time-entries/active").expect(401);
  });

  it("lista paginada e totais por pessoa (faturável à parte; o que corre conta até agora)", async () => {
    const t = await newTask();
    await manual({ workItemId: t.id, startedAt: ago(5), endedAt: ago(4) }).expect(201);
    await manual({ workItemId: t.id, startedAt: ago(4), endedAt: ago(3.5), billable: false }).expect(201);
    await manual({ workItemId: t.id, startedAt: ago(5), endedAt: ago(3) }, ana).expect(201);
    const other = await newTask("Outra");
    await manual({ workItemId: other.id, startedAt: ago(8), endedAt: ago(7) }).expect(201);

    const summary = (await api().get(`/time-entries/summary?workItemId=${t.id}`).set("Authorization", rui).expect(200)).body;
    expect(summary).toEqual({
      totalSeconds: 3 * 3600 + 1800,
      billableSeconds: 3 * 3600,
      byUser: [
        { user: { id: anaUser.id, name: "Ana Comercial" }, totalSeconds: 7200, billableSeconds: 7200 },
        { user: { id: ruiUser.id, name: "Rui Técnico" }, totalSeconds: 5400, billableSeconds: 3600 },
      ],
    });

    const page = (await api().get(`/time-entries?workItemId=${t.id}&limit=2`).set("Authorization", rui).expect(200)).body;
    expect(page.items).toHaveLength(2);
    const rest = (await api().get(`/time-entries?workItemId=${t.id}&limit=2&cursor=${page.nextCursor}`).set("Authorization", rui).expect(200)).body;
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    const startedDesc = [...page.items, ...rest.items].map((e: { startedAt: string }) => e.startedAt);
    expect(startedDesc).toEqual([...startedDesc].sort().reverse());
    expect((await api().get(`/time-entries?userId=${anaUser.id}`).set("Authorization", rui).expect(200)).body.items).toHaveLength(1);

    await api().post("/time-entries/start").set("Authorization", rui).send({ workItemId: t.id }).expect(201);
    await prisma().timeEntry.updateMany({ where: { endedAt: null }, data: { startedAt: new Date(ago(0.5)) } });
    const withRunning = (await api().get(`/time-entries/summary?workItemId=${t.id}`).set("Authorization", rui).expect(200)).body;
    expect(withRunning.totalSeconds).toBeGreaterThanOrEqual(3 * 3600 + 1800 + 1800);
    expect(withRunning.totalSeconds).toBeLessThan(3 * 3600 + 1800 + 1800 + 60);
  });

  it("cronómetro esquecido (mais de 8 h) e desativar a pessoa para o cronómetro dela", async () => {
    const t = await newTask();
    await start(t.id).expect(201);
    await prisma().timeEntry.updateMany({ where: { endedAt: null }, data: { startedAt: new Date(ago(7.9)) } });
    expect((await active()).entry.forgotten).toBe(false);
    await prisma().timeEntry.updateMany({ where: { endedAt: null }, data: { startedAt: new Date(ago(8.1)) } });
    expect((await active()).entry.forgotten).toBe(true);

    await api().patch(`/users/${ruiUser.id}`).set("Authorization", admin).send({ active: false }).expect(200);
    expect(await running()).toHaveLength(0);
  });

  it("automações: «cronómetro parado» ao parar, ao mudar e ao fechar; os registos manuais não", async () => {
    await api()
      .post("/automation-rules")
      .set("Authorization", admin)
      .send({ name: "Faturar", entityType: "WORK_ITEM", trigger: "TIMER_STOPPED", action: "CREATE_WORK_ITEM", actionConfig: { typeId: "TAREFA", title: "Faturar {titulo}", assignee: { mode: "OWNER" } } })
      .expect(201);
    const faturar = () => prisma().workItem.count({ where: { title: { startsWith: "Faturar" } } });

    const a = await newTask("A");
    const b = await newTask("B");
    await start(a.id).expect(201);
    await stop().expect(200);
    expect(await faturar()).toBe(1);
    await start(a.id).expect(201);
    await start(b.id).expect(201);
    expect(await faturar()).toBe(2);
    await api().patch(`/tasks/${b.id}`).set("Authorization", rui).send({ status: "DONE" }).expect(200);
    expect(await faturar()).toBe(3);
    await manual({ workItemId: a.id, startedAt: ago(9), endedAt: ago(8) }).expect(201);
    expect(await faturar()).toBe(3);
    // Fechar sem cronómetro a correr não conta.
    await api().patch(`/tasks/${a.id}`).set("Authorization", rui).send({ status: "DONE" }).expect(200);
    expect(await faturar()).toBe(3);
  });
});
