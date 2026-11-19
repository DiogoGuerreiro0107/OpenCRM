import { OPEN_WORK_ITEM_STATUSES } from "../tasks/work-item-status";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { OPEN_STEP_WHERE, stageTypeOf } from "../workflows/workflow-steps";

const STALE_DEAL_DAYS = 14;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
  ) {}

  async getSummary() {
    // Indicadores de um módulo desligado não se calculam nem se devolvem (ficam a null).
    const leadsOn = this.modules.isEnabled("leads");
    const dealsOn = this.modules.isEnabled("deals");
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const staleThreshold = new Date(now.getTime() - STALE_DEAL_DAYS * 24 * 60 * 60 * 1000);

    const [
      companiesTotal,
      contactsTotal,
      leadsNew,
      tasksToday,
      tasksOverdue,
      staleDeals,
      pipelines,
    ] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.contact.count(),
      leadsOn ? this.prisma.lead.count({ where: { status: "NOVO" } }) : Promise.resolve(null),
      this.prisma.workItem.count({
        where: { status: { in: OPEN_WORK_ITEM_STATUSES }, dueDate: { gte: startOfToday, lt: startOfTomorrow } },
      }),
      this.prisma.workItem.count({
        where: { status: { in: OPEN_WORK_ITEM_STATUSES }, dueDate: { lt: startOfToday } },
      }),
      dealsOn
        ? this.prisma.deal.count({ where: { stage: OPEN_STEP_WHERE, updatedAt: { lt: staleThreshold } } })
        : Promise.resolve(null),
      dealsOn ? this.getPipelineBreakdown() : Promise.resolve([]),
    ]);

    const openValueAgg = dealsOn
      ? await this.prisma.deal.aggregate({ where: { stage: OPEN_STEP_WHERE }, _sum: { value: true } })
      : null;

    const dealsOpen = pipelines.reduce((sum, p) => sum + p.open, 0);
    const dealsWon = pipelines.reduce((sum, p) => sum + p.won, 0);
    const dealsLost = pipelines.reduce((sum, p) => sum + p.lost, 0);

    return {
      companiesTotal,
      contactsTotal,
      leadsNew,
      dealsOpen: dealsOn ? dealsOpen : null,
      dealsWon: dealsOn ? dealsWon : null,
      dealsLost: dealsOn ? dealsLost : null,
      openValue: dealsOn ? (openValueAgg?._sum.value ?? 0) : null,
      tasksToday,
      tasksOverdue,
      staleDeals,
      staleDealDays: STALE_DEAL_DAYS,
      pipelines,
      modules: { leads: leadsOn, deals: dealsOn },
    };
  }

  private async getPipelineBreakdown() {
    // Contagens na base de dados (por fase), em vez de ler todos os negócios de sempre para os contar aqui.
    const [pipelines, perStage] = await Promise.all([
      this.prisma.workflow.findMany({
        where: { entityType: "DEAL" },
        include: { steps: { select: { id: true, category: true, outcome: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.deal.groupBy({ by: ["stageId"], _count: true }),
    ]);
    const countByStage = new Map(perStage.map((g) => [g.stageId, g._count]));

    return pipelines.map((pipeline) => {
      const countOf = (type: "OPEN" | "WON" | "LOST") =>
        pipeline.steps.filter((s) => stageTypeOf(s) === type).reduce((sum, s) => sum + (countByStage.get(s.id) ?? 0), 0);
      const open = countOf("OPEN");
      const won = countOf("WON");
      const lost = countOf("LOST");
      const closed = won + lost;
      const conversionRate = closed > 0 ? Math.round((won / closed) * 100) : 0;

      return { id: pipeline.id, name: pipeline.name, open, won, lost, conversionRate };
    });
  }
}
