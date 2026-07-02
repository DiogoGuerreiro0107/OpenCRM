import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const STALE_DEAL_DAYS = 14;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
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
      this.prisma.lead.count({ where: { status: "NOVO" } }),
      this.prisma.task.count({
        where: { status: { not: "DONE" }, dueDate: { gte: startOfToday, lt: startOfTomorrow } },
      }),
      this.prisma.task.count({
        where: { status: { not: "DONE" }, dueDate: { lt: startOfToday } },
      }),
      this.prisma.deal.count({
        where: { stage: { type: "OPEN" }, updatedAt: { lt: staleThreshold } },
      }),
      this.getPipelineBreakdown(),
    ]);

    const openValueAgg = await this.prisma.deal.aggregate({
      where: { stage: { type: "OPEN" } },
      _sum: { value: true },
    });

    const dealsOpen = pipelines.reduce((sum, p) => sum + p.open, 0);
    const dealsWon = pipelines.reduce((sum, p) => sum + p.won, 0);
    const dealsLost = pipelines.reduce((sum, p) => sum + p.lost, 0);

    return {
      companiesTotal,
      contactsTotal,
      leadsNew,
      dealsOpen,
      dealsWon,
      dealsLost,
      openValue: openValueAgg._sum.value ?? 0,
      tasksToday,
      tasksOverdue,
      staleDeals,
      staleDealDays: STALE_DEAL_DAYS,
      pipelines,
    };
  }

  private async getPipelineBreakdown() {
    const pipelines = await this.prisma.pipeline.findMany({
      include: { deals: { include: { stage: { select: { type: true } } } } },
      orderBy: { createdAt: "asc" },
    });

    return pipelines.map((pipeline) => {
      const open = pipeline.deals.filter((d) => d.stage.type === "OPEN").length;
      const won = pipeline.deals.filter((d) => d.stage.type === "WON").length;
      const lost = pipeline.deals.filter((d) => d.stage.type === "LOST").length;
      const closed = won + lost;
      const conversionRate = closed > 0 ? Math.round((won / closed) * 100) : 0;

      return { id: pipeline.id, name: pipeline.name, open, won, lost, conversionRate };
    });
  }
}
