import { INestApplication } from "@nestjs/common";
import axios from "axios";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";
import { JobsService } from "../src/jobs/jobs.service";
import { AutomationsService } from "../src/automations/automations.service";
import { JOB_LIST } from "../src/jobs/job-catalog";

// Fase E1.2 (docs/plano-fase-e1-extensoes.md): tarefas agendadas do núcleo — registo das passagens, saltos, limite de
// tempo, disjuntor, «Correr agora», ligar/desligar, retomar, aviso e auditoria.
describe("Tarefas agendadas (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  const jobs = () => app.get(JobsService);
  let admin: string;
  let adminId: string;
  let comercial: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    const user = await createUser(prisma(), "ADMINISTRADOR", "Ana Admin");
    adminId = user.id;
    admin = await bearerFor(app, user);
    comercial = await bearerFor(app, await createUser(prisma(), "COMERCIAL"));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app.close();
  });

  const runsOf = (jobId: string) => prisma().scheduledJobRun.findMany({ where: { jobId }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
  const stateOf = (jobId: string) => prisma().scheduledJobState.findUnique({ where: { jobId } });
  const zadarmaAccount = () => api().patch("/extensions/zadarma/settings").set("Authorization", admin).send({ apiKey: "k", apiSecret: "s", callerExtension: "100" }).expect(200);
  type JobView = { id: string; enabled: boolean; pausedAt: string | null; pausedReason: string | null; consecutiveFailures: number; lastError: string | null; running: boolean; extension: { id: string; label: string; enabled: boolean } | null };
  const view = async (id: string) => ((await api().get("/jobs").set("Authorization", admin).expect(200)).body as JobView[]).find((j) => j.id === id)!;

  it("lista: só o Administrador; as seis tarefas com dona, horário e estado por omissão", async () => {
    await api().get("/jobs").set("Authorization", comercial).expect(403);
    await api().get("/jobs").expect(401);
    await api().post("/jobs/jobs.purge-runs/run").set("Authorization", comercial).expect(403);
    const list = (await api().get("/jobs").set("Authorization", admin).expect(200)).body as JobView[];
    expect(list.map((j) => j.id)).toEqual(JOB_LIST.map((j) => j.id));
    expect(list.find((j) => j.id === "zadarma.sync")).toMatchObject({
      label: "Sincronização das chamadas da Zadarma",
      extension: { id: "zadarma", label: "Telefonia (Zadarma)", enabled: true },
      scheduleText: "De 10 em 10 minutos",
      pauseAfterFailures: 6,
      enabled: true,
      pausedAt: null,
      consecutiveFailures: 0,
      running: false,
    });
    expect(list.find((j) => j.id === "webhooks.deliver")!.extension).toBeNull();
    await api().get("/jobs/nao-existe/runs").set("Authorization", admin).expect(404);
    await api().post("/jobs/nao-existe/run").set("Authorization", admin).expect(404);
  });

  it("«Correr agora»: regista a passagem (quem, resumo), o estado e a auditoria", async () => {
    const old = await prisma().scheduledJobRun.create({
      data: { jobId: "zadarma.sync", trigger: "SCHEDULE", startedAt: new Date(Date.now() - 31 * 864e5), finishedAt: new Date(Date.now() - 31 * 864e5), status: "SUCCESS" },
    });
    const recent = await prisma().scheduledJobRun.create({
      data: { jobId: "zadarma.sync", trigger: "SCHEDULE", startedAt: new Date(Date.now() - 29 * 864e5), finishedAt: new Date(Date.now() - 29 * 864e5), status: "SUCCESS" },
    });
    const res = await api().post("/jobs/jobs.purge-runs/run").set("Authorization", admin).expect(200);
    expect(res.body.run).toMatchObject({ jobId: "jobs.purge-runs", trigger: "MANUAL", triggeredById: adminId, status: "SUCCESS", summary: "1 passagem apagada", error: null });
    // Só a de há mais de 30 dias.
    expect(await prisma().scheduledJobRun.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(res.body.job).toMatchObject({ id: "jobs.purge-runs", consecutiveFailures: 0, lastError: null });
    expect(res.body.job.lastSuccessAt).not.toBeNull();
    expect(await prisma().scheduledJobRun.findUnique({ where: { id: old.id } })).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    const second = await api().post("/jobs/jobs.purge-runs/run").set("Authorization", admin).expect(200);
    const runs = (await api().get("/jobs/jobs.purge-runs/runs").set("Authorization", admin).expect(200)).body;
    // A mais recente primeiro.
    expect(runs.map((r: { id: string }) => r.id)).toEqual([second.body.run.id, res.body.run.id]);
    expect(runs[0].triggeredBy).toEqual({ id: adminId, name: "Ana Admin" });
    const audit = await prisma().auditEvent.findMany({ where: { action: "job.run" } });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ actorId: adminId, targetType: "job", targetId: "jobs.purge-runs" });

    // As outras tarefas reais correm à mão.
    for (const id of ["api.idempotency-purge", "automations.purge-runs", "automations.scheduled", "webhooks.deliver", "zadarma.sync"]) {
      const r = await api().post(`/jobs/${id}/run`).set("Authorization", admin).expect(200);
      expect({ id, status: r.body.run.status }).toEqual({ id, status: "SUCCESS" });
    }
    expect((await runsOf("zadarma.sync")).at(-1)!.summary).toBe("Sem conta ativa");
    expect((await runsOf("webhooks.deliver"))[0].summary).toBe("0 entregas");
  });

  it("extensão dona desligada: a automática salta sem registo; à mão, 409", async () => {
    await api().patch("/modules/zadarma").set("Authorization", admin).send({ enabled: false }).expect(200);
    await jobs().trigger("zadarma.sync");
    expect(await runsOf("zadarma.sync")).toEqual([]);
    expect(await stateOf("zadarma.sync")).toBeNull();
    const res = await api().post("/jobs/zadarma.sync/run").set("Authorization", admin).expect(409);
    expect(res.body.message).toBe("O módulo «Telefonia (Zadarma)» está desligado");
    expect((await view("zadarma.sync")).extension).toMatchObject({ enabled: false });
  });

  it("disjuntor: falhas seguidas põem a tarefa em pausa (auditoria, aviso); a manual bem-sucedida tira-a", async () => {
    await zadarmaAccount();
    const failing = jest.spyOn(axios, "request").mockRejectedValue(new Error("ligação recusada"));
    for (let i = 0; i < 5; i++) await jobs().trigger("zadarma.sync");
    expect(await stateOf("zadarma.sync")).toMatchObject({ consecutiveFailures: 5, pausedAt: null });
    expect((await api().get("/jobs/alerts").set("Authorization", admin).expect(200)).body).toEqual([]);

    await jobs().trigger("zadarma.sync"); // a 6.ª
    const state = await stateOf("zadarma.sync");
    expect(state).toMatchObject({ consecutiveFailures: 6, lastError: "Falha ao sincronizar com a Zadarma: ligação recusada" });
    expect(state!.pausedAt).not.toBeNull();
    expect(state!.pausedReason).toBe("6 falhas seguidas. Última: Falha ao sincronizar com a Zadarma: ligação recusada");
    const runs = await runsOf("zadarma.sync");
    expect(runs.map((r) => r.status)).toEqual(Array(6).fill("FAILED"));
    expect(runs.every((r) => r.trigger === "SCHEDULE" && r.triggeredById === null)).toBe(true);
    const paused = await prisma().auditEvent.findMany({ where: { action: "job.paused" } });
    expect(paused).toHaveLength(1);
    expect(paused[0]).toMatchObject({ actorId: null, targetId: "zadarma.sync", metadata: { failures: 6 } });
    const alerts = (await api().get("/jobs/alerts").set("Authorization", admin).expect(200)).body;
    expect(alerts).toEqual([expect.objectContaining({ id: "zadarma.sync", label: "Sincronização das chamadas da Zadarma" })]);
    await api().get("/jobs/alerts").set("Authorization", comercial).expect(403);

    // Em pausa: a automática já não corre (nem chama a Zadarma).
    failing.mockClear();
    await jobs().trigger("zadarma.sync");
    expect(failing).not.toHaveBeenCalled();
    expect(await runsOf("zadarma.sync")).toHaveLength(6);

    // À mão, a falhar: continua em pausa.
    const manualFail = await api().post("/jobs/zadarma.sync/run").set("Authorization", admin).expect(200);
    expect(manualFail.body.run.status).toBe("FAILED");
    expect(manualFail.body.job.pausedAt).not.toBeNull();

    // À mão, com sucesso: sai da pausa e as falhas voltam a 0.
    failing.mockResolvedValue({ data: { stats: [] } });
    const ok = await api().post("/jobs/zadarma.sync/run").set("Authorization", admin).expect(200);
    expect(ok.body.run).toMatchObject({ status: "SUCCESS", summary: "0 chamadas novas" });
    expect(ok.body.job).toMatchObject({ pausedAt: null, pausedReason: null, consecutiveFailures: 0 });
    expect((await api().get("/jobs/alerts").set("Authorization", admin).expect(200)).body).toEqual([]);
  });

  it("«Retomar» tira da pausa sem correr; uma falha depois de um sucesso recomeça a contagem", async () => {
    await zadarmaAccount();
    const spy = jest.spyOn(axios, "request").mockRejectedValue(new Error("x"));
    for (let i = 0; i < 6; i++) await jobs().trigger("zadarma.sync");
    expect((await stateOf("zadarma.sync"))!.pausedAt).not.toBeNull();
    const resumed = await api().post("/jobs/zadarma.sync/resume").set("Authorization", admin).expect(200);
    expect(resumed.body).toMatchObject({ pausedAt: null, consecutiveFailures: 0 });
    expect(await runsOf("zadarma.sync")).toHaveLength(6);
    expect(await prisma().auditEvent.count({ where: { action: "job.resumed", actorId: adminId } })).toBe(1);

    await jobs().trigger("zadarma.sync");
    expect((await stateOf("zadarma.sync"))!.consecutiveFailures).toBe(1);
    spy.mockResolvedValue({ data: { stats: [{ pbx_call_id: "c1", from: "210000000", to: "100", direction: "in", duration: 5 }] } });
    await jobs().trigger("zadarma.sync");
    expect(await stateOf("zadarma.sync")).toMatchObject({ consecutiveFailures: 0, pausedAt: null });
    expect((await runsOf("zadarma.sync")).at(-1)).toMatchObject({ status: "SUCCESS", summary: "1 chamada nova" });
    // A mesma chamada outra vez não é nova.
    await jobs().trigger("zadarma.sync");
    expect((await runsOf("zadarma.sync")).at(-1)).toMatchObject({ status: "SUCCESS", summary: "0 chamadas novas" });
    spy.mockRejectedValue(new Error("y"));
    await jobs().trigger("zadarma.sync");
    expect((await stateOf("zadarma.sync"))!.consecutiveFailures).toBe(1);
  });

  it("desligada: a automática não corre; à mão corre; ligar volta a correr", async () => {
    const off = await api().patch("/jobs/automations.purge-runs").set("Authorization", admin).send({ enabled: false }).expect(200);
    expect(off.body.enabled).toBe(false);
    await api().patch("/jobs/automations.purge-runs").set("Authorization", admin).send({ enabled: "não" }).expect(400);
    await jobs().trigger("automations.purge-runs");
    expect(await runsOf("automations.purge-runs")).toEqual([]);
    await api().post("/jobs/automations.purge-runs/run").set("Authorization", admin).expect(200);
    expect(await runsOf("automations.purge-runs")).toHaveLength(1);
    await api().patch("/jobs/automations.purge-runs").set("Authorization", admin).send({ enabled: true }).expect(200);
    await jobs().trigger("automations.purge-runs");
    expect((await runsOf("automations.purge-runs")).map((r) => r.trigger)).toEqual(["MANUAL", "SCHEDULE"]);
    expect(await prisma().auditEvent.count({ where: { action: "job.toggled" } })).toBe(2);
  });

  it("limite de tempo: conta como falha; a seguinte só começa quando o trabalho acabar", async () => {
    jest.spyOn(jobs() as unknown as { timeoutOf: () => number }, "timeoutOf").mockReturnValue(50);
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    jest.spyOn(app.get(AutomationsService), "purgeOldRuns").mockImplementation(async () => {
      await slow;
      return { summary: "acabou" };
    });
    await jobs().trigger("automations.purge-runs");
    const runs = await runsOf("automations.purge-runs");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "TIMEOUT", error: "Passou o limite de 0 s (o trabalho continua até acabar)" });
    expect((await stateOf("automations.purge-runs"))!.consecutiveFailures).toBe(1);

    // Ainda a correr: a automática salta e a manual é recusada.
    expect((await view("automations.purge-runs")).running).toBe(true);
    await jobs().trigger("automations.purge-runs");
    expect(await runsOf("automations.purge-runs")).toHaveLength(1);
    const busy = await api().post("/jobs/automations.purge-runs/run").set("Authorization", admin).expect(409);
    expect(busy.body.message).toBe("A tarefa já está a correr: espera que acabe");

    finish();
    await new Promise((r) => setTimeout(r, 20));
    expect((await view("automations.purge-runs")).running).toBe(false);
    jest.spyOn(jobs() as unknown as { timeoutOf: () => number }, "timeoutOf").mockReturnValue(5000);
    await jobs().trigger("automations.purge-runs");
    expect((await runsOf("automations.purge-runs")).map((r) => r.status)).toEqual(["TIMEOUT", "SUCCESS"]);
  });

  it("passagens sem trabalho: nas tarefas frequentes não ficam no registo (só o estado); à mão, sempre", async () => {
    await jobs().trigger("webhooks.deliver");
    expect(await runsOf("webhooks.deliver")).toEqual([]);
    const state = await stateOf("webhooks.deliver");
    expect(state).toMatchObject({ consecutiveFailures: 0 });
    expect(state!.lastRunAt).not.toBeNull();
    // As outras ficam sempre.
    await jobs().trigger("api.idempotency-purge");
    expect(await runsOf("api.idempotency-purge")).toHaveLength(1);

    // Com trabalho, a frequente fica: uma entrega pendente para um endereço que recusa.
    const sub = (await api().post("/webhooks/subscriptions").set("Authorization", admin).send({ name: "x", url: "http://127.0.0.1:9/hook", events: ["*"] }).expect(201)).body;
    await prisma().webhookDelivery.create({
      data: { subscriptionId: sub.id, eventId: "e1", eventType: "lead.created", payload: {}, nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await jobs().trigger("webhooks.deliver");
    expect((await runsOf("webhooks.deliver")).map((r) => [r.status, r.summary])).toEqual([["SUCCESS", "1 entrega"]]);
  });

  it("uma falha da fila de webhooks conta como falha da tarefa", async () => {
    jest.spyOn(prisma().webhookDelivery, "findMany").mockRejectedValueOnce(new Error("base de dados indisponível"));
    await jobs().trigger("webhooks.deliver");
    expect((await runsOf("webhooks.deliver")).map((r) => [r.status, r.error])).toEqual([["FAILED", "base de dados indisponível"]]);
  });
});
