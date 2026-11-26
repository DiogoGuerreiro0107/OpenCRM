import { CronExpression } from "@nestjs/schedule";
import { ModuleId } from "../modules/module-manifest";

/**
 * Catálogo das tarefas agendadas (Fase E1.2, docs/plano-fase-e1-extensoes.md). O agendador é do núcleo: cada `@Cron`
 * só chama `JobsService.trigger(id)`, e o trabalho é registado pelo serviço dono (`JobsService.handle`). Um teste
 * estrutural garante as duas coisas.
 */

export interface JobDefinition {
  id: string;
  label: string;
  description: string;
  /** Extensão dona (com ela desligada a tarefa não corre); null = núcleo. */
  extension: ModuleId | null;
  /** Expressão do `@Cron` (o decorador usa esta mesma constante). */
  cron: string;
  /** O horário em português, para a página. */
  scheduleText: string;
  /** Passado isto a passagem conta como falha (o trabalho não se interrompe). */
  timeoutMs: number;
  /** Ao fim de tantas falhas seguidas a tarefa fica em pausa (disjuntor). */
  pauseAfterFailures: number;
  /** As passagens sem trabalho ficam no registo? (Não, nas tarefas muito frequentes.) */
  recordIdleRuns: boolean;
}

/** O que o trabalho de uma tarefa devolve: um resumo e se não havia nada para fazer. */
export interface JobOutcome {
  summary?: string;
  idle?: boolean;
}

const MIN = 60_000;

export const JOBS = {
  "webhooks.deliver": {
    id: "webhooks.deliver",
    label: "Entrega de webhooks",
    description: "Envia os eventos pendentes para os webhooks subscritos e repete os que falharam.",
    extension: null,
    cron: "*/30 * * * * *",
    scheduleText: "De 30 em 30 segundos",
    timeoutMs: 2 * MIN,
    pauseAfterFailures: 20,
    recordIdleRuns: false,
  },
  "zadarma.sync": {
    id: "zadarma.sync",
    label: "Sincronização das chamadas da Zadarma",
    description: "Vai buscar à Zadarma as chamadas novas e liga-as aos contactos e empresas pelo número.",
    extension: "zadarma",
    cron: CronExpression.EVERY_10_MINUTES,
    scheduleText: "De 10 em 10 minutos",
    timeoutMs: 2 * MIN,
    pauseAfterFailures: 6,
    recordIdleRuns: true,
  },
  "automations.scheduled": {
    id: "automations.scheduled",
    label: "Automações por tempo",
    description: "Corre as regras de automação com gatilhos de tempo (ex.: parado há X dias no passo).",
    extension: "automations",
    cron: CronExpression.EVERY_HOUR,
    scheduleText: "De hora a hora",
    timeoutMs: 10 * MIN,
    pauseAfterFailures: 3,
    recordIdleRuns: true,
  },
  "automations.purge-runs": {
    id: "automations.purge-runs",
    label: "Limpeza do histórico das automações",
    description: "Apaga o histórico de execuções das automações mais antigo do que o prazo de retenção.",
    extension: "automations",
    cron: CronExpression.EVERY_DAY_AT_3AM,
    scheduleText: "Todos os dias às 3:00",
    timeoutMs: 5 * MIN,
    pauseAfterFailures: 3,
    recordIdleRuns: true,
  },
  "api.idempotency-purge": {
    id: "api.idempotency-purge",
    label: "Limpeza da idempotência da API",
    description: "Apaga os registos de Idempotency-Key da API pública com mais de 24 horas.",
    extension: null,
    cron: CronExpression.EVERY_DAY_AT_3AM,
    scheduleText: "Todos os dias às 3:00",
    timeoutMs: 5 * MIN,
    pauseAfterFailures: 3,
    recordIdleRuns: true,
  },
  "jobs.purge-runs": {
    id: "jobs.purge-runs",
    label: "Limpeza do registo das tarefas",
    description: "Apaga as passagens das tarefas agendadas com mais de 30 dias.",
    extension: null,
    cron: "0 30 3 * * *",
    scheduleText: "Todos os dias às 3:30",
    timeoutMs: 5 * MIN,
    pauseAfterFailures: 3,
    recordIdleRuns: true,
  },
} as const satisfies Record<string, JobDefinition>;

export type JobId = keyof typeof JOBS;

export const JOB_LIST: JobDefinition[] = Object.values(JOBS);

export const isJobId = (value: string): value is JobId => Object.prototype.hasOwnProperty.call(JOBS, value);

/** Passagens guardadas durante tanto tempo. */
export const RUN_RETENTION_DAYS = 30;
