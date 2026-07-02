import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AutomationRule, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { CreateAutomationRuleDto } from "./dto/create-automation-rule.dto";
import { UpdateAutomationRuleDto } from "./dto/update-automation-rule.dto";

const RULE_INCLUDE = {
  pipeline: { select: { id: true, name: true } },
  stage: { select: { id: true, name: true } },
} as const;

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  findAll() {
    return this.prisma.automationRule.findMany({ orderBy: { createdAt: "desc" }, include: RULE_INCLUDE });
  }

  async findOne(id: string) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id }, include: RULE_INCLUDE });
    if (!rule) throw new NotFoundException("Regra de automação não encontrada");
    return rule;
  }

  create(dto: CreateAutomationRuleDto) {
    return this.prisma.automationRule.create({
      data: dto as Prisma.AutomationRuleUncheckedCreateInput,
      include: RULE_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateAutomationRuleDto) {
    await this.ensureExists(id);
    return this.prisma.automationRule.update({
      where: { id },
      data: dto as Prisma.AutomationRuleUncheckedUpdateInput,
      include: RULE_INCLUDE,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.automationRule.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.automationRule.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Regra de automação não encontrada");
  }

  /** Corre periodicamente: negócios parados há X dias numa fase. */
  @Cron(CronExpression.EVERY_HOUR)
  async evaluateIdleRules() {
    const rules = await this.prisma.automationRule.findMany({
      where: { active: true, triggerType: "STAGE_IDLE_TIME" },
    });

    for (const rule of rules) {
      if (!rule.stageId) continue;
      const days = Number((rule.triggerConfig as { days?: number }).days);
      if (!days || days <= 0) continue;

      const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const deals = await this.prisma.deal.findMany({
        where: { stageId: rule.stageId, stageEnteredAt: { lte: threshold } },
      });

      for (const deal of deals) {
        await this.executeAction(deal.id, rule);
      }
    }
  }

  /** Chamado quando uma tarefa é concluída, para reavaliar regras "tarefas concluídas". */
  async evaluateTaskCompletedRules(dealId: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) return;

    const remaining = await this.prisma.task.count({ where: { dealId, status: { not: "DONE" } } });
    if (remaining > 0) return;

    const rules = await this.prisma.automationRule.findMany({
      where: { active: true, triggerType: "TASK_COMPLETED", stageId: deal.stageId },
    });
    for (const rule of rules) {
      await this.executeAction(dealId, rule);
    }
  }

  /** Chamado após atualizar um negócio, para reavaliar regras "campo alterado". */
  async evaluateFieldChangedRules(
    dealId: string,
    pipelineId: string,
    changes: Record<string, { before: unknown; after: unknown }>,
  ) {
    if (Object.keys(changes).length === 0) return;

    const rules = await this.prisma.automationRule.findMany({
      where: {
        active: true,
        triggerType: "FIELD_CHANGED",
        OR: [{ pipelineId }, { pipelineId: null }],
      },
    });

    for (const rule of rules) {
      const config = rule.triggerConfig as { field?: string; operator?: string; value?: unknown };
      if (!config.field) continue;
      const change = changes[config.field];
      if (!change) continue;
      if (this.matchesCondition(change.after, config.operator, config.value)) {
        await this.executeAction(dealId, rule);
      }
    }
  }

  private matchesCondition(actual: unknown, operator: string | undefined, expected: unknown): boolean {
    if (typeof actual === "number" && typeof expected === "number") {
      switch (operator) {
        case "gt":
          return actual > expected;
        case "gte":
          return actual >= expected;
        case "lt":
          return actual < expected;
        case "lte":
          return actual <= expected;
        case "eq":
          return actual === expected;
        default:
          return false;
      }
    }
    return operator === "eq" && actual === expected;
  }

  private async executeAction(dealId: string, rule: AutomationRule) {
    try {
      if (rule.actionType === "MOVE_STAGE") {
        const config = rule.actionConfig as { targetStageId?: string };
        if (!config.targetStageId) return;
        const targetStage = await this.prisma.stage.findUnique({ where: { id: config.targetStageId } });
        if (!targetStage) return;

        const last = await this.prisma.deal.findFirst({
          where: { stageId: targetStage.id },
          orderBy: { order: "desc" },
        });

        await this.prisma.deal.update({
          where: { id: dealId },
          data: {
            stageId: targetStage.id,
            pipelineId: targetStage.pipelineId,
            order: (last?.order ?? -1) + 1,
            stageEnteredAt: new Date(),
            closedAt: targetStage.type === "OPEN" ? null : new Date(),
          },
        });

        this.webhooks.trigger("automation.deal_moved", {
          dealId,
          ruleId: rule.id,
          ruleName: rule.name,
          toStageId: targetStage.id,
          toPipelineId: targetStage.pipelineId,
        });
      } else if (rule.actionType === "TRIGGER_WEBHOOK") {
        const config = rule.actionConfig as { event?: string };
        this.webhooks.trigger(config.event ?? "automation.triggered", { dealId, ruleId: rule.id, ruleName: rule.name });
      }
    } catch (err) {
      this.logger.warn(`Falha ao executar automação '${rule.name}' para negócio ${dealId}: ${(err as Error).message}`);
    }
  }
}
