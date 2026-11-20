import { WorkItemPriority } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { WebhooksService } from "../../webhooks/webhooks.service";
import { RealtimeService } from "../../realtime/realtime.service";
import { isOpenStep } from "../../workflows/workflow-steps";
import { AutomationEntityType, LoadedRecord, automationEntity } from "./automation-entities";
import { AutomationEvent } from "./automation-triggers";
import { DUE_UNITS, DueUnit, dueFrom, renderTemplate, templateVariables } from "./helpers";

/**
 * Ações das automações (Fase 3a; criar tarefa e atribuir na 3b; docs/plano-fase-3-automacoes.md). Cada ação diz a que
 * tipos de registo se aplica, como validar a configuração (pode consultar a base de dados) e como se executa. A execução
 * devolve o texto do histórico; um erro fica no histórico como falha e não desfaz a operação que causou o evento.
 */

/** Escritas em tarefas feitas pelos serviços das tarefas (passo, timeline, eventos), na cadeia da automação. */
export interface TaskWriter {
  create: (data: TaskDraft, creatorId: string) => Promise<{ id: string; title: string }>;
  moveToStep: (id: string, stepId: string, actorId: string) => Promise<void>;
}

export interface TaskDraft {
  title: string;
  typeId: string;
  assigneeId: string;
  dueDate?: string;
  priority?: WorkItemPriority;
  companyId?: string;
  contactId?: string;
  dealId?: string;
  leadId?: string;
}

export interface ActionContext {
  prisma: PrismaService;
  webhooks: WebhooksService;
  realtime: RealtimeService;
  rule: { id: string; name: string };
  entityType: AutomationEntityType;
  entityId: string;
  /** Quem causou o evento (quando há uma pessoa). */
  actorId: string | null;
  /** O registo como estava quando a regra correu. */
  record: LoadedRecord;
  /** Despacha um evento causado por esta ação (na mesma cadeia, um nível abaixo). */
  dispatch: (event: AutomationEvent) => Promise<void>;
  tasks: TaskWriter;
}

export interface AutomationAction {
  label: string;
  /** Tipos de registo a que se aplica; `null` = todos. */
  entities: AutomationEntityType[] | null;
  config: (
    prisma: PrismaService,
    raw: Record<string, unknown>,
    rule: { entityType: AutomationEntityType; workflowId: string | null },
  ) => Promise<Record<string, unknown>>;
  execute: (ctx: ActionContext, config: Record<string, unknown>) => Promise<string>;
}

/** Nomes de eventos de webhook escolhidos pelo administrador: `recurso.acao` (como os do catálogo). */
const EVENT_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
const DEFAULT_WEBHOOK_EVENT = "automation.triggered";
const MAX_DUE = { hours: 24 * 365, days: 365, business_days: 260 } satisfies Record<DueUnit, number>;
const PRIORITIES: WorkItemPriority[] = ["BAIXA", "NORMAL", "ALTA", "URGENTE"];
const RESOURCE_OF: Record<AutomationEntityType, string> = { DEAL: "deals", WORK_ITEM: "tasks", LEAD: "leads" };

async function activeUser(prisma: PrismaService, id: unknown) {
  if (typeof id !== "string") return null;
  return prisma.user.findFirst({ where: { id, active: true }, select: { id: true, name: true } });
}

export const AUTOMATION_ACTIONS = {
  /** Mover o registo para um passo (negócios: de qualquer funil; tarefas: do fluxo do tipo da regra). */
  MOVE_TO_STEP: {
    label: "Mover para um passo",
    entities: ["DEAL", "WORK_ITEM"],
    config: async (prisma, raw, rule) => {
      const step = typeof raw.targetStepId === "string"
        ? await prisma.workflowStep.findUnique({ where: { id: raw.targetStepId }, include: { workflow: { select: { entityType: true } } } })
        : null;
      if (!step || step.workflow.entityType !== automationEntity(rule.entityType).workflowEntity) throw new Error("Escolhe o passo de destino");
      // Nas tarefas, os passos são do tipo de tarefa: a regra tem de estar limitada a esse tipo (o seu fluxo).
      if (rule.entityType === "WORK_ITEM" && step.workflowId !== rule.workflowId) throw new Error("Nas tarefas, o passo de destino tem de ser do tipo de tarefa da regra");
      return { targetStepId: step.id };
    },
    execute: async (ctx, config) => {
      const { prisma, webhooks, realtime, rule, entityType, entityId } = ctx;
      const target = await prisma.workflowStep.findUnique({ where: { id: config.targetStepId as string } });
      if (!target) throw new Error("O passo de destino já não existe");
      if (entityType === "WORK_ITEM") {
        if (ctx.record.stepId === target.id) return `Já estava em «${target.name}»`;
        // Pelo serviço das tarefas: estado do passo, timeline ao fechar e os eventos «entrou no passo» e «fechado».
        await ctx.tasks.moveToStep(entityId, target.id, ctx.actorId ?? ctx.record.ownerId!);
        return `Movida para «${target.name}»`;
      }
      const before = await prisma.deal.findUnique({ where: { id: entityId }, include: { stage: true } });
      if (!before) throw new Error("O negócio já não existe");
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
      if (before.stageId !== target.id) {
        await ctx.dispatch({ entityType: "DEAL", entityId, trigger: "ENTERED_STEP", actorId: ctx.actorId });
        if (isOpenStep(before.stage) && !isOpenStep(target)) await ctx.dispatch({ entityType: "DEAL", entityId, trigger: "CLOSED", actorId: ctx.actorId });
      }
      return `Movido para «${target.name}»`;
    },
  },
  /** Enviar um evento de webhook (para o n8n). */
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
  /**
   * Criar uma tarefa a partir de um modelo (Fase 3b): tipo, título com variáveis do registo, responsável, prazo e
   * prioridade; ligada ao registo de origem. A tarefa nova dispara o «criado» das tarefas.
   */
  CREATE_WORK_ITEM: {
    label: "Criar tarefa",
    entities: null,
    config: async (prisma, raw, rule) => {
      const entity = automationEntity(rule.entityType);
      const type = typeof raw.typeId === "string" ? await prisma.workItemType.findUnique({ where: { id: raw.typeId } }) : null;
      if (!type || !type.active) throw new Error("Escolhe um tipo de tarefa ativo");
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      if (!title || title.length > 200) throw new Error("O título da tarefa é obrigatório (até 200 caracteres)");
      const unknown = templateVariables(title).filter((v) => !(v in entity.variables));
      if (unknown.length > 0) throw new Error(`Variáveis desconhecidas: ${unknown.map((v) => `{${v}}`).join(", ")} (disponíveis: ${Object.keys(entity.variables).map((v) => `{${v}}`).join(", ")})`);

      const assignee = (raw.assignee ?? {}) as Record<string, unknown>;
      if (!["OWNER", "ACTOR", "USER"].includes(assignee.mode as string)) throw new Error("Escolhe o responsável da tarefa");
      if (assignee.mode === "USER" && !(await activeUser(prisma, assignee.userId))) throw new Error("O responsável escolhido não existe ou está desativado");

      let due: { amount: number; unit: DueUnit } | undefined;
      if (raw.due !== undefined && raw.due !== null) {
        const d = raw.due as Record<string, unknown>;
        const unit = d.unit as DueUnit;
        if (!DUE_UNITS.includes(unit) || typeof d.amount !== "number" || !Number.isInteger(d.amount) || d.amount < 0 || d.amount > MAX_DUE[unit]) {
          throw new Error("Prazo inválido (número inteiro de horas, dias ou dias úteis)");
        }
        due = { amount: d.amount, unit };
      }
      if (raw.priority !== undefined && !PRIORITIES.includes(raw.priority as WorkItemPriority)) throw new Error("Prioridade inválida");

      return {
        typeId: type.id,
        title,
        assignee: assignee.mode === "USER" ? { mode: "USER", userId: assignee.userId } : { mode: assignee.mode },
        ...(due ? { due } : {}),
        ...(raw.priority ? { priority: raw.priority } : {}),
      };
    },
    execute: async (ctx, config) => {
      const assignee = config.assignee as { mode: "OWNER" | "ACTOR" | "USER"; userId?: string };
      const assigneeId =
        assignee.mode === "USER" ? assignee.userId : assignee.mode === "ACTOR" ? (ctx.actorId ?? ctx.record.ownerId) : (ctx.record.ownerId ?? ctx.actorId);
      if (!assigneeId || !(await activeUser(ctx.prisma, assigneeId))) throw new Error("Sem responsável ativo para a tarefa");
      const due = config.due as { amount: number; unit: DueUnit } | undefined;
      const task = await ctx.tasks.create(
        {
          title: renderTemplate(config.title as string, ctx.record.variables) || "Tarefa",
          typeId: config.typeId as string,
          assigneeId,
          dueDate: due ? dueFrom(new Date(), due.amount, due.unit).toISOString() : undefined,
          priority: config.priority as WorkItemPriority | undefined,
          companyId: ctx.record.links.companyId ?? undefined,
          contactId: ctx.record.links.contactId ?? undefined,
          dealId: ctx.record.links.dealId ?? undefined,
          leadId: ctx.record.links.leadId ?? undefined,
        },
        ctx.actorId ?? assigneeId,
      );
      ctx.realtime.emit("tasks", "AUTOMATION");
      return `Tarefa «${task.title}» criada`;
    },
  },
  /** Atribuir o registo a um utilizador (Fase 3b). Dispara o «campo alterado» do responsável. */
  ASSIGN: {
    label: "Atribuir a",
    entities: null,
    config: async (prisma, raw) => {
      const user = await activeUser(prisma, raw.userId);
      if (!user) throw new Error("Escolhe um utilizador ativo");
      return { userId: user.id };
    },
    execute: async (ctx, config) => {
      const user = await activeUser(ctx.prisma, config.userId);
      if (!user) throw new Error("O utilizador já não existe ou está desativado");
      if (ctx.record.ownerId === user.id) return `${user.name} já era o responsável`;
      const entity = automationEntity(ctx.entityType);
      await entity.setOwner(ctx.prisma, ctx.entityId, user.id);
      ctx.realtime.emit(RESOURCE_OF[ctx.entityType], "AUTOMATION");
      await ctx.dispatch({ entityType: ctx.entityType, entityId: ctx.entityId, trigger: "FIELD_CHANGED", changedFields: [entity.ownerField], actorId: ctx.actorId });
      return `Atribuído a ${user.name}`;
    },
  },
} satisfies Record<string, AutomationAction>;

export type AutomationActionId = keyof typeof AUTOMATION_ACTIONS;

export const AUTOMATION_ACTION_IDS = Object.keys(AUTOMATION_ACTIONS) as AutomationActionId[];

export const isAutomationActionId = (value: unknown): value is AutomationActionId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(AUTOMATION_ACTIONS, value);

export const automationAction = (id: AutomationActionId): AutomationAction => AUTOMATION_ACTIONS[id];

export const actionApplies = (action: AutomationAction, entityType: AutomationEntityType) => action.entities === null || action.entities.includes(entityType);
