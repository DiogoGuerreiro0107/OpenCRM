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
      this.prisma.task.count({
        where: { status: { not: "DONE" }, dueDate: { gte: startOfToday, lt: startOfTomorrow } },
      }),
      this.prisma.task.count({
        where: { status: { not: "DONE" }, dueDate: { lt: startOfToday } },
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
    const pipelines = await this.prisma.workflow.findMany({
      where: { entityType: "DEAL" },
      include: { deals: { include: { stage: { select: { category: true, outcome: true } } } } },
      orderBy: { createdAt: "asc" },
    });

    return pipelines.map((pipeline) => {
      const open = pipeline.deals.filter((d) => stageTypeOf(d.stage) === "OPEN").length;
      const won = pipeline.deals.filter((d) => stageTypeOf(d.stage) === "WON").length;
      const lost = pipeline.deals.filter((d) => stageTypeOf(d.stage) === "LOST").length;
      const closed = won + lost;
      const conversionRate = closed > 0 ? Math.round((won / closed) * 100) : 0;

      return { id: pipeline.id, name: pipeline.name, open, won, lost, conversionRate };
    });
  }
}
