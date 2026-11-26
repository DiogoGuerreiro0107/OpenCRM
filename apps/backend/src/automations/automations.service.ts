import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { JobsService } from "../jobs/jobs.service";
import { JobOutcome } from "../jobs/job-catalog";
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
import { AUTOMATION_ACTIONS, AUTOMATION_ACTION_IDS, TaskWriter, actionApplies, automationAction, isAutomationActionId } from "./registry/automation-actions";
import { AutomationField, Condition, OPERATORS, OPERATORS_BY_KIND, normalizeConditions } from "./registry/conditions";
import { customAutomationFields, customAutomationValues } from "./registry/helpers";
import { ensureSystemAutomationRules } from "./registry/system-rules";
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
export class AutomationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly realtime: RealtimeService,
    private readonly modules: ModulesService,
    jobs: JobsService,
  ) {
    jobs.handle("automations.scheduled", () => this.runScheduled());
    jobs.handle("automations.purge-runs", () => this.purgeOldRuns());
  }

  /**
   * Escritas em tarefas feitas pelas ações (criar tarefa, mover tarefa). O serviço das tarefas regista-se aqui ao
   * arrancar (depende deste para os eventos; ao contrário, criava uma dependência circular entre os dois).
   */
  private taskWriterFor: ((chain: Chain) => TaskWriter) | null = null;

  registerTaskWriter(factory: (chain: Chain) => TaskWriter) {
    this.taskWriterFor = factory;
  }

  /** Regras do sistema (ex.: primeiro contacto da lead): o arranque cria as que faltem, sem mexer nas existentes. */
  async onApplicationBootstrap() {
    await ensureSystemAutomationRules(this.prisma);
  }

  /** Campos das condições de um tipo de registo: os do registo e os personalizados «disponíveis em automações». */
  private async fieldsOf(entityType: AutomationEntityType): Promise<AutomationField[]> {
    const entity = automationEntity(entityType);
    const base = await Promise.all(entity.fields.map((field) => this.withOptions(field)));
    return [...base, ...(await customAutomationFields(this.prisma, entity.customFieldEntity))];
  }

  /** Opções lidas da base de dados (Fase 3c): os tipos de tarefa que existem, também os desativados. */
  private async withOptions(field: AutomationField): Promise<AutomationField> {
    if (field.optionsFrom !== "workItemTypes") return field;
    const types = await this.prisma.workItemType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } });
    return { ...field, options: types.map((t) => ({ value: t.id, label: t.active ? t.name : `${t.name} (desativado)` })) };
  }

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
    const rule = await this.prisma.automationRule.findUnique({ where: { id }, select: { id: true, systemKey: true, name: true } });
    if (!rule) throw new NotFoundException("Regra de automação não encontrada");
    // Uma regra do sistema voltava no arranque seguinte: desativa-se em vez de se apagar.
    if (rule.systemKey) throw new BadRequestException(`«${rule.name}» é uma regra do sistema: podes desativá-la ou alterá-la, mas não apagá-la`);
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
      conditions = normalizeConditions(await this.fieldsOf(entityType), input.conditions ?? []);
      actionConfig = await action.config(this.prisma, input.actionConfig ?? {}, { entityType, workflowId });
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
  async catalog() {
    const types = AUTOMATION_ENTITY_TYPES.filter((type) => this.active(type));
    const fields = await Promise.all(types.map((type) => this.fieldsOf(type)));
    const entities = types.map((type, i) => {
      const entity: (typeof AUTOMATION_ENTITIES)[AutomationEntityType] = AUTOMATION_ENTITIES[type];
      return {
        id: type,
        label: entity.label,
        workflowEntity: entity.workflowEntity,
        fields: fields[i],
        changeTracked: entity.changeTracked,
        variables: entity.variables,
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

  async findRuns(query: QueryAutomationRunsDto & PageQueryDto) {
    const where: Prisma.AutomationRunWhereInput = {
      ...(query.ruleId ? { ruleId: query.ruleId } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
    };
    const page = await readPage(RUN_KEY, query, (after, take) =>
      this.prisma.automationRun.findMany({
        where: after ? { AND: [where, after] } : where,
        orderBy: orderByKey(RUN_KEY),
        take,
        include: { rule: { select: { id: true, name: true } } },
      }),
    );
    // Nome de cada registo (Fase 3c), lido de uma vez por tipo de registo para a página toda.
    const labels = new Map<string, string>();
    for (const type of new Set(page.items.map((r) => r.entityType))) {
      if (!isAutomationEntityType(type)) continue;
      const ids = page.items.filter((r) => r.entityType === type).map((r) => r.entityId);
      for (const [id, label] of await automationEntity(type).labels(this.prisma, ids)) labels.set(`${type}:${id}`, label);
    }
    return { ...page, items: page.items.map((r) => ({ ...r, entityLabel: labels.get(`${r.entityType}:${r.entityId}`) ?? null })) };
  }

  /** Limpeza diária do histórico (tarefa «automations.purge-runs»). */
  async purgeOldRuns(): Promise<JobOutcome> {
    const limit = new Date(Date.now() - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.automationRun.deleteMany({ where: { createdAt: { lt: limit } } });
    return { summary: `${count} ${count === 1 ? "registo apagado" : "registos apagados"}`, idle: count === 0 };
  }

  // ------------------------------------------------------------------------------------------------------------ motor

  private taskWriter(chain: Chain): TaskWriter {
    if (!this.taskWriterFor) throw new Error("O serviço das tarefas não está disponível");
    return this.taskWriterFor(chain);
  }

  private engine(): EngineDeps {
    return {
      rulesFor: async (entityType, trigger) =>
        (await this.prisma.automationRule.findMany({ where: { active: true, entityType, trigger }, orderBy: { createdAt: "asc" } })).map(toEngineRule),
      load: async (entityType, id) => {
        if (!isAutomationEntityType(entityType)) return null;
        const entity = automationEntity(entityType);
        const record = await entity.load(this.prisma, id);
        if (!record) return null;
        return { ...record, values: { ...record.values, ...(await customAutomationValues(this.prisma, entity.customFieldEntity, id)) } };
      },
      fields: async (entityType) => (isAutomationEntityType(entityType) ? this.fieldsOf(entityType) : []),
      matches: async (rule, event) => {
        if (!isAutomationTriggerId(rule.trigger)) return false;
        const matches = automationTrigger(rule.trigger).matches;
        return matches ? matches(this.prisma, event as AutomationEvent, rule.triggerConfig) : true;
      },
      execute: async (rule, event, chain, record) => {
        if (!isAutomationActionId(rule.action)) throw new Error(`Ação desconhecida: ${rule.action}`);
        // Os eventos causados por esta ação ficam na mesma cadeia, um nível abaixo (proteção contra ciclos).
        const child: Chain = { depth: chain.depth + 1, seen: chain.seen };
        return automationAction(rule.action).execute(
          {
            prisma: this.prisma,
            webhooks: this.webhooks,
            realtime: this.realtime,
            rule,
            entityType: event.entityType as AutomationEntityType,
            entityId: event.entityId,
            actorId: event.actorId ?? null,
            record,
            dispatch: (next) => this.dispatch(next, child),
            tasks: this.taskWriter(child),
          },
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

  /**
   * De hora a hora (tarefa «automations.scheduled»): gatilhos agendados (ex.: parado há X dias no passo). Condições não
   * cumpridas não vão ao histórico; a falha de uma regra fica no histórico das automações e não para as outras.
   */
  async runScheduled(): Promise<JobOutcome> {
    if (!this.modules.isEnabled("automations")) return { summary: "Módulo desligado", idle: true };
    const deps = this.engine();
    let checked = 0;
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
        checked++;
        await runRule(deps, rule, { entityType: rule.entityType, entityId, trigger: rule.trigger }, record, newChain(), false).catch((err: Error) =>
          this.logger.warn(`Automação agendada '${rule.name}': ${err.message}`),
        );
      }
    }
    return { summary: `${checked} ${checked === 1 ? "registo verificado" : "registos verificados"}`, idle: checked === 0 };
  }
}
