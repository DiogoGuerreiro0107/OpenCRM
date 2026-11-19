import { PrismaService } from "../../prisma/prisma.service";
import { WebhooksService } from "../../webhooks/webhooks.service";
import { RealtimeService } from "../../realtime/realtime.service";
import { isOpenStep } from "../../workflows/workflow-steps";
import { AutomationEntityType, automationEntity } from "./automation-entities";

/**
 * Ações das automações (Fase 3a, docs/plano-fase-3-automacoes.md). Cada ação diz a que tipos de registo se aplica, como
 * validar a sua configuração (pode consultar a base de dados) e como se executa. A execução devolve o texto que fica no
 * histórico; um erro fica no histórico como falha e não desfaz a operação que causou o evento.
 */

export interface ActionContext {
  prisma: PrismaService;
  webhooks: WebhooksService;
  realtime: RealtimeService;
  rule: { id: string; name: string };
  entityType: AutomationEntityType;
  entityId: string;
}

export interface AutomationAction {
  label: string;
  /** Tipos de registo a que se aplica; `null` = todos. */
  entities: AutomationEntityType[] | null;
  config: (prisma: PrismaService, raw: Record<string, unknown>, rule: { entityType: AutomationEntityType }) => Promise<Record<string, unknown>>;
  execute: (ctx: ActionContext, config: Record<string, unknown>) => Promise<string>;
}

/** Nomes de eventos de webhook escolhidos pelo administrador: `recurso.acao` (como os do catálogo). */
const EVENT_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const DEFAULT_WEBHOOK_EVENT = "automation.triggered";

export const AUTOMATION_ACTIONS = {
  /** Mover o registo para um passo (de qualquer fluxo do mesmo tipo; era MOVE_STAGE). */
  MOVE_TO_STEP: {
    label: "Mover para um passo",
    entities: ["DEAL"],
    config: async (prisma, raw, rule) => {
      const step = typeof raw.targetStepId === "string"
        ? await prisma.workflowStep.findUnique({ where: { id: raw.targetStepId }, include: { workflow: { select: { entityType: true } } } })
        : null;
      if (!step || step.workflow.entityType !== automationEntity(rule.entityType).workflowEntity) throw new Error("Escolhe o passo de destino");
      return { targetStepId: step.id };
    },
    execute: async ({ prisma, webhooks, realtime, rule, entityId }, config) => {
      const target = await prisma.workflowStep.findUnique({ where: { id: config.targetStepId as string } });
      if (!target) throw new Error("O passo de destino já não existe");
      const last = await prisma.deal.findFirst({ where: { stageId: target.id }, orderBy: { order: "desc" } });
      await prisma.deal.update({
        where: { id: entityId },
        data: {
          stageId: target.id,
          pipelineId: target.workflowId,
          order: (last?.order ?? -1) + 1,
          stageEnteredAt: new Date(),
          closedAt: isOpenStep(target) ? null : new Date(),
        },
      });
      // Fora de um pedido HTTP (agendamento/gatilhos): o interceptor global não o vê, por isso avisa-se aqui.
      realtime.emit("deals", "AUTOMATION");
      webhooks.trigger("automation.deal_moved", { dealId: entityId, ruleId: rule.id, ruleName: rule.name, toStageId: target.id, toPipelineId: target.workflowId });
      return `Movido para «${target.name}»`;
    },
  },
  /** Enviar um evento de webhook (para o n8n); era TRIGGER_WEBHOOK. */
  WEBHOOK: {
    label: "Enviar webhook (n8n)",
    entities: null,
    config: async (_prisma, raw) => {
      const event = typeof raw.event === "string" && raw.event.trim() ? raw.event.trim() : DEFAULT_WEBHOOK_EVENT;
      if (event.length > 100 || !EVENT_NAME.test(event)) throw new Error("Nome de evento inválido (ex.: automation.proposta_enviada)");
      return { event };
    },
    execute: async ({ webhooks, rule, entityType, entityId }, config) => {
      const event = config.event as string;
      // `dealId` mantém-se nos negócios (era o único campo antes da 3a; workflows do n8n podem usá-lo).
      webhooks.trigger(event, { entityType, entityId, ...(entityType === "DEAL" ? { dealId: entityId } : {}), ruleId: rule.id, ruleName: rule.name });
      return `Webhook «${event}»`;
    },
  },
} satisfies Record<string, AutomationAction>;

export type AutomationActionId = keyof typeof AUTOMATION_ACTIONS;

export const AUTOMATION_ACTION_IDS = Object.keys(AUTOMATION_ACTIONS) as AutomationActionId[];

export const isAutomationActionId = (value: unknown): value is AutomationActionId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(AUTOMATION_ACTIONS, value);

export const automationAction = (id: AutomationActionId): AutomationAction => AUTOMATION_ACTIONS[id];

export const actionApplies = (action: AutomationAction, entityType: AutomationEntityType) => action.entities === null || action.entities.includes(entityType);
