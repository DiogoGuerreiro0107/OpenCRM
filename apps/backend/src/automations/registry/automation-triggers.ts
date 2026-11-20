import { OPEN_WORK_ITEM_STATUSES } from "../../tasks/work-item-status";
import { PrismaService } from "../../prisma/prisma.service";
import { AutomationEntity, AutomationEntityType } from "./automation-entities";

/**
 * Gatilhos das automações (Fase 3a, docs/plano-fase-3-automacoes.md). Cada gatilho diz a que tipos de registo se aplica,
 * se a regra precisa de passo, como validar a sua configuração e, quando é preciso, se um evento interessa mesmo à regra
 * (`matches`) ou que registos o cumprem agora (`scheduled`, para os que correm de hora a hora).
 */

export interface AutomationEvent {
  entityType: AutomationEntityType;
  entityId: string;
  trigger: AutomationTriggerId;
  /** Campos que mudaram (gatilho «campo alterado»). */
  changedFields?: string[];
  /** Quem causou o evento (uma pessoa; nos agendados e na API pública pode não haver). */
  actorId?: string | null;
}

export interface AutomationTrigger {
  label: string;
  entities: AutomationEntityType[];
  /** «required» = a regra tem de indicar o passo; «optional» = pode limitar-se a um passo. */
  step: "required" | "optional";
  /** Corre de hora a hora, em vez de reagir a um evento. */
  scheduled: boolean;
  /** Valida e normaliza a configuração; lança Error com a mensagem para o administrador. */
  config: (raw: Record<string, unknown>, entity: AutomationEntity) => Record<string, unknown>;
  /** O evento interessa a esta regra? (além do tipo de registo, do gatilho e do âmbito) */
  matches?: (prisma: PrismaService, event: AutomationEvent, config: Record<string, unknown>) => Promise<boolean>;
  /** Gatilhos agendados: ids dos registos que cumprem o gatilho agora. */
  findDue?: (prisma: PrismaService, rule: { stepId: string | null; triggerConfig: Record<string, unknown> }) => Promise<string[]>;
}

const MAX_IDLE_DAYS = 3650;

export const AUTOMATION_TRIGGERS = {
  /** Parado X dias no passo da regra (era STAGE_IDLE_TIME). */
  IDLE_IN_STEP: {
    label: "Parado há X dias no passo",
    entities: ["DEAL"],
    step: "required",
    scheduled: true,
    config: (raw) => {
      const days = raw.days;
      if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_IDLE_DAYS) {
        throw new Error(`Indica os dias (número inteiro entre 1 e ${MAX_IDLE_DAYS})`);
      }
      return { days };
    },
    findDue: async (prisma, rule) => {
      const days = rule.triggerConfig.days as number;
      if (!rule.stepId || !days) return [];
      const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const deals = await prisma.deal.findMany({ where: { stageId: rule.stepId, stageEnteredAt: { lte: threshold } }, select: { id: true } });
      return deals.map((d) => d.id);
    },
  },
  /** Fechou-se a última tarefa em aberto do registo (era TASK_COMPLETED). */
  ALL_TASKS_CLOSED: {
    label: "Todas as tarefas fechadas",
    entities: ["DEAL"],
    step: "required",
    scheduled: false,
    config: () => ({}),
    matches: async (prisma, event) =>
      (await prisma.workItem.count({ where: { dealId: event.entityId, status: { in: OPEN_WORK_ITEM_STATUSES } } })) === 0,
  },
  /** Um campo do registo mudou (as condições dizem para que valores). */
  FIELD_CHANGED: {
    label: "Campo alterado",
    entities: ["DEAL", "WORK_ITEM", "LEAD"],
    step: "optional",
    scheduled: false,
    config: (raw, entity) => {
      const field = entity.fields.find((f) => f.name === raw.field && entity.changeTracked.includes(f.name));
      if (!field) throw new Error("Escolhe o campo que tem de mudar");
      return { field: field.name };
    },
    matches: async (_prisma, event, config) => !!event.changedFields?.includes(config.field as string),
  },
  /** Criado (por uma pessoa, pela API pública ou por outra automação). Fase 3b. */
  CREATED: {
    label: "Criado",
    entities: ["DEAL", "WORK_ITEM", "LEAD"],
    step: "optional",
    scheduled: false,
    config: () => ({}),
  },
  /** Mudou para o passo da regra (criar já num passo não conta: usa «criado» com o passo). Fase 3b. */
  ENTERED_STEP: {
    label: "Entrou no passo",
    entities: ["DEAL", "WORK_ITEM"],
    step: "required",
    scheduled: false,
    config: () => ({}),
  },
  /** Fechado: negócio ganho ou perdido, tarefa concluída ou cancelada, lead convertida ou perdida. Fase 3b. */
  CLOSED: {
    label: "Fechado",
    entities: ["DEAL", "WORK_ITEM", "LEAD"],
    step: "optional",
    scheduled: false,
    config: () => ({}),
  },
} satisfies Record<string, AutomationTrigger>;

export type AutomationTriggerId = keyof typeof AUTOMATION_TRIGGERS;

export const AUTOMATION_TRIGGER_IDS = Object.keys(AUTOMATION_TRIGGERS) as AutomationTriggerId[];

export const isAutomationTriggerId = (value: unknown): value is AutomationTriggerId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(AUTOMATION_TRIGGERS, value);

export const automationTrigger = (id: AutomationTriggerId): AutomationTrigger => AUTOMATION_TRIGGERS[id];
