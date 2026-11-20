import type { AutomationCatalog, AutomationCondition, AutomationRule } from "@opencrm/shared-types";

/**
 * Frase de uma regra de automação («Quando uma lead é criada e Interesse é igual a POS, então atribuir a Rui»), usada na
 * lista e na pré-visualização do editor (Fase 3c). Os nomes vêm do catálogo do servidor e das listas já carregadas.
 */

export interface AutomationLookups {
  catalog?: AutomationCatalog;
  /** Nome de cada passo/fase (id → nome) e de cada fluxo (funil ou tipo de tarefa). */
  steps: Map<string, string>;
  workflows: Map<string, string>;
  users: Map<string, string>;
  types: Map<string, string>;
}

type RuleLike = Pick<AutomationRule, "entityType" | "workflowId" | "stepId" | "trigger" | "triggerConfig" | "conditions" | "action" | "actionConfig">;

const SUBJECT: Record<string, { article: string; noun: string; feminine: boolean }> = {
  DEAL: { article: "um", noun: "negócio", feminine: false },
  WORK_ITEM: { article: "uma", noun: "tarefa", feminine: true },
  LEAD: { article: "uma", noun: "lead", feminine: true },
};

const DUE_UNITS: Record<string, [string, string]> = { hours: ["hora", "horas"], days: ["dia", "dias"], business_days: ["dia útil", "dias úteis"] };
const PRIORITIES: Record<string, string> = { BAIXA: "baixa", NORMAL: "normal", ALTA: "alta", URGENTE: "urgente" };

const quote = (text: string | undefined | null) => `«${text ?? "?"}»`;

function conditionText(c: AutomationCondition, entityType: string, lookups: AutomationLookups) {
  const field = lookups.catalog?.entities.find((e) => e.id === entityType)?.fields.find((f) => f.name === c.field);
  const op = lookups.catalog?.operators[c.operator] ?? c.operator;
  if (c.operator === "empty" || c.operator === "not_empty") return `${field?.label ?? c.field} ${op}`;
  const value =
    field?.kind === "user"
      ? (lookups.users.get(String(c.value)) ?? "?")
      : field?.kind === "option"
        ? (field.options?.find((o) => o.value === c.value)?.label ?? String(c.value))
        : String(c.value ?? "");
  return `${field?.label ?? c.field} ${op} ${value}`;
}

function triggerText(rule: RuleLike, lookups: AutomationLookups) {
  const subject = SUBJECT[rule.entityType] ?? { article: "um", noun: rule.entityType, feminine: false };
  const done = (masc: string, fem: string) => (subject.feminine ? fem : masc);
  const step = rule.stepId ? quote(lookups.steps.get(rule.stepId)) : "?";
  switch (rule.trigger) {
    case "CREATED":
      return `é ${done("criado", "criada")}`;
    case "CLOSED":
      return `é ${done("fechado", "fechada")}`;
    case "ENTERED_STEP":
      return `entra em ${step}`;
    case "IDLE_IN_STEP":
      return `está ${done("parado", "parada")} há ${rule.triggerConfig.days ?? "?"} dias em ${step}`;
    case "TIMER_STOPPED":
      return "tem um cronómetro parado";
    case "ALL_TASKS_CLOSED":
      return `tem todas as tarefas fechadas em ${step}`;
    case "FIELD_CHANGED": {
      const field = lookups.catalog?.entities.find((e) => e.id === rule.entityType)?.fields.find((f) => f.name === rule.triggerConfig.field);
      return `muda de ${field?.label ?? String(rule.triggerConfig.field ?? "?")}`;
    }
    default:
      return rule.trigger;
  }
}

function actionText(rule: RuleLike, lookups: AutomationLookups) {
  const c = rule.actionConfig;
  switch (rule.action) {
    case "MOVE_TO_STEP":
      return `mover para ${quote(lookups.steps.get(String(c.targetStepId)))}`;
    case "WEBHOOK":
      return `enviar o webhook ${quote(String(c.event ?? "automation.triggered"))}`;
    case "ASSIGN":
      return `atribuir a ${lookups.users.get(String(c.userId)) ?? "?"}`;
    case "CREATE_WORK_ITEM": {
      const assignee = (c.assignee ?? {}) as { mode?: string; userId?: string };
      const who =
        assignee.mode === "USER" ? (lookups.users.get(String(assignee.userId)) ?? "?") : assignee.mode === "ACTOR" ? "quem fez a ação" : "o responsável do registo";
      const due = c.due as { amount?: number; unit?: string } | undefined;
      const dueText = due?.unit ? `, prazo daqui a ${due.amount} ${DUE_UNITS[due.unit]?.[due.amount === 1 ? 0 : 1] ?? due.unit}` : "";
      const priority = c.priority ? `, prioridade ${PRIORITIES[String(c.priority)] ?? c.priority}` : "";
      return `criar a tarefa ${quote(String(c.title ?? ""))} (${lookups.types.get(String(c.typeId)) ?? "?"}) para ${who}${dueText}${priority}`;
    }
    default:
      return rule.action;
  }
}

/** «Quando … e …, então …». */
export function describeRule(rule: RuleLike, lookups: AutomationLookups) {
  const subject = SUBJECT[rule.entityType] ?? { article: "um", noun: rule.entityType, feminine: false };
  const scope = !rule.stepId && rule.workflowId ? ` (${rule.entityType === "WORK_ITEM" ? "tipo" : "funil"} ${quote(lookups.workflows.get(rule.workflowId))})` : "";
  const conditions = rule.conditions.map((c) => conditionText(c, rule.entityType, lookups));
  const ifText = conditions.length ? ` e ${conditions.join(" e ")}` : "";
  return `Quando ${subject.article} ${subject.noun}${scope} ${triggerText(rule, lookups)}${ifText}, então ${actionText(rule, lookups)}.`;
}
