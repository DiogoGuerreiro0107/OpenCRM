import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AutomationRule, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { RealtimeService } from "../realtime/realtime.service";
import { ModulesService } from "../modules/modules.service";
import { KeyField, PageQueryDto, orderByKey, readPage } from "../common/pagination";
import { CreateAutomationRuleDto, QueryAutomationRunsDto } from "./dto/create-automation-rule.dto";
import { UpdateAutomationRuleDto } from "./dto/update-automation-rule.dto";
import { AUTOMATION_ENTITIES, AUTOMATION_ENTITY_TYPES, AutomationEntityType, automationEntity, isAutomationEntityType } from "./registry/automation-entities";
import { AUTOMATION_TRIGGERS, AUTOMATION_TRIGGER_IDS, AutomationEvent, automationTrigger, isAutomationTriggerId } from "./registry/automation-triggers";
import { AUTOMATION_ACTIONS, AUTOMATION_ACTION_IDS, actionApplies, automationAction, isAutomationActionId } from "./registry/automation-actions";
import { Condition, OPERATORS, OPERATORS_BY_KIND, normalizeConditions } from "./registry/conditions";
import { Chain, EngineDeps, EngineEvent, EngineRule, newChain, runEvent, runRule } from "./registry/engine";

const RULE_INCLUDE = {
  workflow: { select: { id: true, name: true } },
  step: { select: { id: true, name: true } },
} as const;

/** Histórico: do mais recente para o mais antigo. */
const RUN_KEY: KeyField[] = [
  { field: "createdAt", dir: "desc", kind: "date" },
  { field: "id", dir: "desc", kind: "string" },
];

/** Dias que o histórico guarda. */
export const RUN_RETENTION_DAYS = 90;

const toEngineRule = (rule: AutomationRule): EngineRule => ({
  ...rule,
  triggerConfig: (rule.triggerConfig ?? {}) as Record<string, unknown>,
  actionConfig: (rule.actionConfig ?? {}) as Record<string, unknown>,
  conditions: (Array.isArray(rule.conditions) ? rule.conditions : []) as unknown as Condition[],
});

/**
 * Automações (Fase 3a, docs/plano-fase-3-automacoes.md): regras por tipo de registo, validadas contra os registos de
 * gatilhos, ações e campos (src/automations/registry/), e um único ponto de entrada para os eventos (`dispatch`).
 */
@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly realtime: RealtimeService,
    private readonly modules: ModulesService,
  ) {}

  /** As regras de um tipo de registo só correm com o módulo de automações E o do tipo de registo ativos. */
  private active(entityType: AutomationEntityType) {
    const module = automationEntity(entityType).module;
    return this.modules.isEnabled("automations") && (!module || this.modules.isEnabled(module));
  }

  // ---------------------------------------------------------------------------------------------------------- regras

  findAll() {
    return this.prisma.automationRule.findMany({ orderBy: { createdAt: "desc" }, include: RULE_INCLUDE });
  }

  async findOne(id: string) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id }, include: RULE_INCLUDE });
    if (!rule) throw new NotFoundException("Regra de automação não encontrada");
    return rule;
  }

  async create(dto: CreateAutomationRuleDto) {
    const data = await this.validate(dto);
    return this.prisma.automationRule.create({ data: { name: dto.name.trim(), active: dto.active ?? true, ...data }, include: RULE_INCLUDE });
  }

  /** Alterar valida a regra inteira (o que vem no pedido por cima do que já existe). */
  async update(id: string, dto: UpdateAutomationRuleDto) {
    const existing = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Regra de automação não encontrada");
    const merged = {
      entityType: dto.entityType ?? existing.entityType,
      workflowId: dto.workflowId !== undefined ? dto.workflowId : existing.workflowId,
      stepId: dto.stepId !== undefined ? dto.stepId : existing.stepId,
      trigger: dto.trigger ?? existing.trigger,
      triggerConfig: dto.triggerConfig ?? (existing.triggerConfig as Record<string, unknown>),
      conditions: dto.conditions ?? (existing.conditions as unknown[]),
      action: dto.action ?? existing.action,
      actionConfig: dto.actionConfig ?? (existing.actionConfig as Record<string, unknown>),
    };
    const data = await this.validate(merged);
    return this.prisma.automationRule.update({
      where: { id },
      data: { ...(dto.name !== undefined ? { name: dto.name.trim() } : {}), ...(dto.active !== undefined ? { active: dto.active } : {}), ...data },
      include: RULE_INCLUDE,
    });
  }

  async remove(id: string) {
    const exists = await this.prisma.automationRule.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Regra de automação não encontrada");
    await this.prisma.automationRule.delete({ where: { id } });
  }

  /**
   * Valida uma regra contra os registos e devolve os dados a gravar (configurações normalizadas). Mensagens pensadas
   * para o administrador; tudo o que antes se gravava sem verificação.
   */
  private async validate(input: {
    entityType: string;
    workflowId?: string | null;
    stepId?: string | null;
    trigger: string;
    triggerConfig?: Record<string, unknown>;
    conditions?: unknown[];
    action: string;
    actionConfig?: Record<string, unknown>;
  }) {
    const fail = (message: string): never => {
      throw new BadRequestException(message);
    };
    if (!isAutomationEntityType(input.entityType) || !this.active(input.entityType)) fail("Tipo de registo desconhecido ou com o módulo desligado");
    const entityType = input.entityType as AutomationEntityType;
    const entity = automationEntity(entityType);
    if (!isAutomationTriggerId(input.trigger) || !automationTrigger(input.trigger).entities.includes(entityType)) fail("Gatilho desconhecido para este tipo de registo");
    const trigger = automationTrigger(input.trigger as never);
    if (!isAutomationActionId(input.action) || !actionApplies(automationAction(input.action), entityType)) fail("Ação desconhecida para este tipo de registo");
    const action = automationAction(input.action as never);

    // Âmbito: o fluxo é deste tipo de registo; o passo é desse fluxo (ou, sem fluxo, de um fluxo deste tipo).
    let workflowId = input.workflowId || null;
    const stepId = input.stepId || null;
    if (workflowId) {
      const workflow = await this.prisma.workflow.findUnique({ where: { id: workflowId }, select: { entityType: true } });
      if (!workflow || workflow.entityType !== entity.workflowEntity) fail("O fluxo indicado não é deste tipo de registo");
    }
    if (stepId) {
      const step = await this.prisma.workflowStep.findUnique({ where: { id: stepId }, include: { workflow: { select: { id: true, entityType: true } } } });
      if (!step || step.workflow.entityType !== entity.workflowEntity) fail("O passo indicado não é deste tipo de registo");
      if (workflowId && step!.workflow.id !== workflowId) fail("O passo indicado não é do fluxo escolhido");
      workflowId = step!.workflow.id;
    }
    if (trigger.step === "required" && !stepId) fail(`O gatilho «${trigger.label}» precisa de um passo`);

    let triggerConfig: Record<string, unknown> = {};
    let conditions: Condition[] = [];
    let actionConfig: Record<string, unknown> = {};
    try {
      triggerConfig = trigger.config(input.triggerConfig ?? {}, entity);
      conditions = normalizeConditions(entity.fields, input.conditions ?? []);
      actionConfig = await action.config(this.prisma, input.actionConfig ?? {}, { entityType });
    } catch (err) {
      fail((err as Error).message);
    }
    return {
      entityType,
      workflowId,
      stepId,
      trigger: input.trigger,
      triggerConfig: triggerConfig as Prisma.InputJsonValue,
      conditions: conditions as unknown as Prisma.InputJsonValue,
      action: input.action,
      actionConfig: actionConfig as Prisma.InputJsonValue,
    };
  }

  /** O que os registos oferecem (só tipos de registo com o módulo ativo), para a interface montar o editor. */
  catalog() {
    const entities = AUTOMATION_ENTITY_TYPES.filter((type) => this.active(type)).map((type) => {
      const entity = AUTOMATION_ENTITIES[type];
      return {
        id: type,
        label: entity.label,
        workflowEntity: entity.workflowEntity,
        fields: entity.fields,
        triggers: AUTOMATION_TRIGGER_IDS.filter((id) => automationTrigger(id).entities.includes(type)).map((id) => ({
          id,
          label: AUTOMATION_TRIGGERS[id].label,
          step: AUTOMATION_TRIGGERS[id].step,
        })),
        actions: AUTOMATION_ACTION_IDS.filter((id) => actionApplies(automationAction(id), type)).map((id) => ({ id, label: AUTOMATION_ACTIONS[id].label })),
      };
    });
    return { entities, operators: OPERATORS, operatorsByKind: OPERATORS_BY_KIND };
  }

  // -------------------------------------------------------------------------------------------------------- histórico

  findRuns(query: QueryAutomationRunsDto & PageQueryDto) {
    const where: Prisma.AutomationRunWhereInput = {
      ...(query.ruleId ? { ruleId: query.ruleId } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
    };
    return readPage(RUN_KEY, query, (after, take) =>
      this.prisma.automationRun.findMany({
        where: after ? { AND: [where, after] } : where,
        orderBy: orderByKey(RUN_KEY),
        take,
        include: { rule: { select: { id: true, name: true } } },
      }),
    );
  }

  /** Limpeza diária do histórico. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldRuns() {
    const limit = new Date(Date.now() - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.automationRun.deleteMany({ where: { createdAt: { lt: limit } } });
  }

  // ------------------------------------------------------------------------------------------------------------ motor

  private engine(): EngineDeps {
    return {
      rulesFor: async (entityType, trigger) =>
        (await this.prisma.automationRule.findMany({ where: { active: true, entityType, trigger }, orderBy: { createdAt: "asc" } })).map(toEngineRule),
      load: (entityType, id) => (isAutomationEntityType(entityType) ? automationEntity(entityType).load(this.prisma, id) : Promise.resolve(null)),
      fields: (entityType) => (isAutomationEntityType(entityType) ? automationEntity(entityType).fields : []),
      matches: async (rule, event) => {
        if (!isAutomationTriggerId(rule.trigger)) return false;
        const matches = automationTrigger(rule.trigger).matches;
        return matches ? matches(this.prisma, event as AutomationEvent, rule.triggerConfig) : true;
      },
      execute: async (rule, event) => {
        if (!isAutomationActionId(rule.action)) throw new Error(`Ação desconhecida: ${rule.action}`);
        return automationAction(rule.action).execute(
          { prisma: this.prisma, webhooks: this.webhooks, realtime: this.realtime, rule, entityType: event.entityType as AutomationEntityType, entityId: event.entityId },
          rule.actionConfig,
        );
      },
      log: async (run) => {
        await this.prisma.automationRun.create({ data: run }).catch((err: Error) => this.logger.warn(`Histórico de automações: ${err.message}`));
      },
    };
  }

  /**
   * Ponto de entrada único dos eventos (chamado pelos serviços depois de gravar). Nunca lança: uma falha numa automação
   * não desfaz nem atrasa com erro a operação que a causou; fica no histórico.
   */
  async dispatch(event: AutomationEvent, chain: Chain = newChain()) {
    if (!this.active(event.entityType)) return;
    try {
      await runEvent(this.engine(), event as EngineEvent, chain);
    } catch (err) {
      this.logger.warn(`Automações (${event.entityType} ${event.entityId}, ${event.trigger}): ${(err as Error).message}`);
    }
  }

  /** De hora a hora: gatilhos agendados (ex.: parado há X dias no passo). Condições não cumpridas não vão ao histórico. */
  @Cron(CronExpression.EVERY_HOUR)
  async runScheduled() {
    const deps = this.engine();
    const scheduled = AUTOMATION_TRIGGER_IDS.filter((id) => AUTOMATION_TRIGGERS[id].scheduled);
    const rules = await this.prisma.automationRule.findMany({ where: { active: true, trigger: { in: scheduled } } });
    for (const raw of rules) {
      const rule = toEngineRule(raw);
      if (!isAutomationEntityType(rule.entityType) || !this.active(rule.entityType) || !isAutomationTriggerId(rule.trigger)) continue;
      const findDue = automationTrigger(rule.trigger).findDue;
      if (!findDue) continue;
      for (const entityId of await findDue(this.prisma, rule)) {
        const record = await deps.load(rule.entityType, entityId);
        if (!record) continue;
        await runRule(deps, rule, { entityType: rule.entityType, entityId, trigger: rule.trigger }, record, newChain(), false).catch((err: Error) =>
          this.logger.warn(`Automação agendada '${rule.name}': ${err.message}`),
        );
      }
    }
  }
}
