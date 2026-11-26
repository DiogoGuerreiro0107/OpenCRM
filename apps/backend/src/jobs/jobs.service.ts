import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ScheduledJobRunStatus, ScheduledJobTrigger } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { manifestOf } from "../modules/module-manifest";
import { AuditService } from "../audit/audit.service";
import { RealtimeService } from "../realtime/realtime.service";
import { isJobId, JOB_LIST, JobDefinition, JobId, JobOutcome, JOBS, RUN_RETENTION_DAYS } from "./job-catalog";

type Handler = () => Promise<JobOutcome | void>;

/** Uma mensagem de erro para guardar: a primeira linha, encurtada (nunca a pilha). */
export function shortError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const first = text.split("\n")[0].trim() || "Erro sem mensagem";
  return first.length > 500 ? `${first.slice(0, 497)}...` : first;
}

const TIMED_OUT = Symbol("timeout");

/**
 * Registo das tarefas agendadas (Fase E1.2, docs/plano-fase-e1-extensoes.md). Um só caminho de execução: o
 * agendador (`JobsScheduler`) e «Correr agora» passam por `execute`, que salta, regista, aplica o limite de tempo e o
 * disjuntor. Uma só instância do backend: o que está a correr fica em memória.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger("Tarefas agendadas");
  private readonly handlers = new Map<JobId, Handler>();
  /** Passagens em curso (também as que passaram o limite de tempo e ainda não acabaram). */
  private readonly running = new Map<JobId, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {
    this.handle("jobs.purge-runs", () => this.purgeRuns());
  }

  /** O serviço dono regista o trabalho da tarefa (uma vez, ao arrancar). */
  handle(id: JobId, handler: Handler) {
    if (this.handlers.has(id)) throw new Error(`A tarefa ${id} já tem trabalho registado`);
    this.handlers.set(id, handler);
  }

  registeredIds(): JobId[] {
    return [...this.handlers.keys()];
  }

  /** Limite de tempo da tarefa (método à parte para os testes o poderem encurtar). */
  protected timeoutOf(def: JobDefinition) {
    return def.timeoutMs;
  }

  /** Chamado pelo agendador. Nunca lança: uma tarefa que falha fica no registo, não derruba o agendador. */
  async trigger(id: JobId): Promise<void> {
    try {
      await this.execute(id, "SCHEDULE", null);
    } catch (err) {
      this.logger.error(`${id}: ${shortError(err)}`);
    }
  }

  /** «Correr agora» (Administrador): corre mesmo desligada ou em pausa; recusa com a extensão desligada ou a correr. */
  async runNow(id: string, userId: string) {
    if (!isJobId(id)) throw new NotFoundException("Tarefa não encontrada");
    const run = await this.execute(id, "MANUAL", userId);
    return { run, job: await this.view(id) };
  }

  private async execute(id: JobId, trigger: ScheduledJobTrigger, userId: string | null) {
    const def: JobDefinition = JOBS[id];
    const manual = trigger === "MANUAL";
    const handler = this.handlers.get(id);
    if (!handler) throw new Error(`A tarefa ${id} não tem trabalho registado`);
    if (def.extension && !this.modules.isEnabled(def.extension)) {
      if (manual) throw new ConflictException(`O módulo «${manifestOf(def.extension).label}» está desligado`);
      return null;
    }
    if (!manual) {
      const state = await this.prisma.scheduledJobState.findUnique({ where: { jobId: id } });
      if (state && (!state.enabled || state.pausedAt)) return null;
    }
    if (this.running.has(id)) {
      if (manual) throw new ConflictException("A tarefa já está a correr: espera que acabe");
      return null;
    }

    const startedAt = new Date();
    const work = Promise.resolve().then(handler);
    this.running.set(id, work);
    void work.then(
      () => this.running.get(id) === work && this.running.delete(id),
      () => this.running.get(id) === work && this.running.delete(id),
    );

    let timer: NodeJS.Timeout | undefined;
    let status: ScheduledJobRunStatus = "SUCCESS";
    let outcome: JobOutcome = {};
    let error: string | null = null;
    try {
      const result = await Promise.race([work, new Promise<typeof TIMED_OUT>((resolve) => (timer = setTimeout(() => resolve(TIMED_OUT), this.timeoutOf(def))))]);
      if (result === TIMED_OUT) {
        status = "TIMEOUT";
        error = `Passou o limite de ${Math.round(this.timeoutOf(def) / 1000)} s (o trabalho continua até acabar)`;
      } else outcome = (result as JobOutcome | void) ?? {};
    } catch (err) {
      status = "FAILED";
      error = shortError(err);
    } finally {
      clearTimeout(timer);
    }
    const finishedAt = new Date();
    if (error) this.logger.warn(`${def.label}: ${error}`);
    return this.record(def, { trigger, userId, startedAt, finishedAt, status, summary: outcome.summary ?? null, error, idle: !!outcome.idle });
  }

  private async record(
    def: JobDefinition,
    r: { trigger: ScheduledJobTrigger; userId: string | null; startedAt: Date; finishedAt: Date; status: ScheduledJobRunStatus; summary: string | null; error: string | null; idle: boolean },
  ) {
    const jobId = def.id;
    if (r.status === "SUCCESS") {
      const before = await this.prisma.scheduledJobState.findUnique({ where: { jobId } });
      // Correr à mão uma tarefa em pausa, com sucesso, tira-a da pausa.
      const unpause = r.trigger === "MANUAL" && !!before?.pausedAt;
      const data = { lastRunAt: r.startedAt, lastSuccessAt: r.finishedAt, consecutiveFailures: 0, ...(unpause ? { pausedAt: null, pausedReason: null } : {}) };
      await this.prisma.scheduledJobState.upsert({ where: { jobId }, update: data, create: { jobId, ...data } });
      if (unpause) this.realtime.emit("jobs", "resumed");
    } else {
      const data = { lastRunAt: r.startedAt, lastErrorAt: r.finishedAt, lastError: r.error };
      const state = await this.prisma.scheduledJobState.upsert({
        where: { jobId },
        update: { ...data, consecutiveFailures: { increment: 1 } },
        create: { jobId, ...data, consecutiveFailures: 1 },
      });
      if (!state.pausedAt && state.consecutiveFailures >= def.pauseAfterFailures) {
        const reason = `${state.consecutiveFailures} falhas seguidas. Última: ${r.error}`;
        await this.prisma.scheduledJobState.update({ where: { jobId }, data: { pausedAt: r.finishedAt, pausedReason: reason } });
        this.logger.error(`${def.label} ficou em pausa: ${reason}`);
        await this.audit.record({ action: "job.paused", targetType: "job", targetId: jobId, metadata: { failures: state.consecutiveFailures } });
        this.realtime.emit("jobs", "paused");
      }
    }
    // Passagens sem trabalho das tarefas muito frequentes não ficam no registo (só o estado acima).
    if (r.status === "SUCCESS" && r.idle && !def.recordIdleRuns && r.trigger === "SCHEDULE") return null;
    return this.prisma.scheduledJobRun.create({
      data: { jobId, trigger: r.trigger, triggeredById: r.userId, startedAt: r.startedAt, finishedAt: r.finishedAt, status: r.status, summary: r.summary, error: r.error },
    });
  }

  // ---- Página de gestão ----

  private async view(id: JobId, state?: Awaited<ReturnType<PrismaService["scheduledJobState"]["findUnique"]>>) {
    const def: JobDefinition = JOBS[id];
    const s = state === undefined ? await this.prisma.scheduledJobState.findUnique({ where: { jobId: id } }) : state;
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      extension: def.extension ? { id: def.extension, label: manifestOf(def.extension).label, enabled: this.modules.isEnabled(def.extension) } : null,
      scheduleText: def.scheduleText,
      timeoutSeconds: Math.round(def.timeoutMs / 1000),
      pauseAfterFailures: def.pauseAfterFailures,
      enabled: s?.enabled ?? true,
      pausedAt: s?.pausedAt ?? null,
      pausedReason: s?.pausedReason ?? null,
      consecutiveFailures: s?.consecutiveFailures ?? 0,
      lastRunAt: s?.lastRunAt ?? null,
      lastSuccessAt: s?.lastSuccessAt ?? null,
      lastErrorAt: s?.lastErrorAt ?? null,
      lastError: s?.lastError ?? null,
      running: this.running.has(id),
    };
  }

  async list() {
    const states = new Map((await this.prisma.scheduledJobState.findMany()).map((s) => [s.jobId, s]));
    return Promise.all(JOB_LIST.map((def) => this.view(def.id as JobId, states.get(def.id) ?? null)));
  }

  /** As tarefas em pausa, para o aviso dos Administradores. */
  async alerts() {
    const paused = await this.prisma.scheduledJobState.findMany({ where: { pausedAt: { not: null } }, orderBy: { pausedAt: "asc" } });
    return paused.filter((s) => isJobId(s.jobId)).map((s) => ({ id: s.jobId, label: JOBS[s.jobId as JobId].label, pausedAt: s.pausedAt, pausedReason: s.pausedReason }));
  }

  async runs(id: string, limit = 20) {
    if (!isJobId(id)) throw new NotFoundException("Tarefa não encontrada");
    return this.prisma.scheduledJobRun.findMany({
      where: { jobId: id },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: limit,
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
  }

  async setEnabled(id: string, enabled: boolean) {
    if (!isJobId(id)) throw new NotFoundException("Tarefa não encontrada");
    await this.prisma.scheduledJobState.upsert({ where: { jobId: id }, update: { enabled }, create: { jobId: id, enabled } });
    return this.view(id);
  }

  /** Retomar: tira da pausa e recomeça a contagem das falhas. */
  async resume(id: string) {
    if (!isJobId(id)) throw new NotFoundException("Tarefa não encontrada");
    const data = { pausedAt: null, pausedReason: null, consecutiveFailures: 0 };
    await this.prisma.scheduledJobState.upsert({ where: { jobId: id }, update: data, create: { jobId: id, ...data } });
    return this.view(id);
  }

  private async purgeRuns(): Promise<JobOutcome> {
    const limit = new Date(Date.now() - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.scheduledJobRun.deleteMany({ where: { startedAt: { lt: limit } } });
    return { summary: `${count} ${count === 1 ? "passagem apagada" : "passagens apagadas"}`, idle: count === 0 };
  }
}
