import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { OPEN_WORK_ITEM_STATUSES } from "../tasks/work-item-status";
import { ServiceIndicatorsQueryDto } from "./dto/service-part.dto";

/** Período máximo dos indicadores (evita pedidos de décadas). */
const MAX_PERIOD_DAYS = 3660;
const TOP_PARTS = 10;

/** Início do mês corrente (UTC) e início do seguinte: o período por omissão. */
function currentMonth(now = new Date()) {
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
}

/**
 * Indicadores das assistências (Fase 4c, docs/plano-fase-4-assistencias.md), num período [from, to) e, opcionalmente,
 * para uma pessoa (responsável das assistências; no tempo, o técnico que o registou).
 */
@Injectable()
export class ServiceIndicatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async indicators(query: ServiceIndicatorsQueryDto) {
    const fallback = currentMonth();
    const from = query.from ? new Date(query.from) : fallback.from;
    const to = query.to ? new Date(query.to) : fallback.to;
    if (to <= from) throw new BadRequestException("O fim do período tem de ser depois do início");
    if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * 86_400_000) throw new BadRequestException("Período demasiado longo (máximo 10 anos)");
    const assignee = query.assigneeId ? Prisma.sql`AND w."assigneeId" = ${query.assigneeId}` : Prisma.empty;
    const assigneeWhere = query.assigneeId ? { assigneeId: query.assigneeId } : {};

    // Em aberto por passo (estado atual, sem período).
    const openGroups = await this.prisma.workItem.groupBy({
      by: ["stepId", "status"],
      where: { serviceCase: { isNot: null }, status: { in: OPEN_WORK_ITEM_STATUSES }, ...assigneeWhere },
      _count: { _all: true },
    });
    const steps = await this.prisma.workflowStep.findMany({
      where: { id: { in: openGroups.map((g) => g.stepId).filter((id): id is string => !!id) } },
      select: { id: true, name: true, order: true },
    });
    const stepOf = new Map(steps.map((s) => [s.id, s]));
    const openByStep = openGroups
      .map((g) => {
        const step = g.stepId ? stepOf.get(g.stepId) : undefined;
        return { stepId: g.stepId, name: step?.name ?? (g.status === "IN_PROGRESS" ? "Em curso" : "Por fazer"), order: step?.order ?? -1, count: g._count._all };
      })
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map(({ order: _order, ...rest }) => rest);

    const inPeriod = { gte: from, lt: to };
    const [created, resolved, notRepaired] = await Promise.all([
      this.prisma.serviceCase.count({ where: { createdAt: inPeriod, workItem: assigneeWhere } }),
      this.prisma.workItem.count({ where: { serviceCase: { isNot: null }, status: "DONE", closedAt: inPeriod, ...assigneeWhere } }),
      this.prisma.workItem.count({ where: { serviceCase: { isNot: null }, status: "CANCELLED", closedAt: inPeriod, ...assigneeWhere } }),
    ]);

    // Tempo até resolver: da entrada à conclusão, das concluídas no período.
    const [resolution] = await this.prisma.$queryRaw<Array<{ avg: number | null; median: number | null }>>`
      SELECT avg(EXTRACT(EPOCH FROM (w."closedAt" - sc."createdAt")))::float8 AS avg,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (w."closedAt" - sc."createdAt")))::float8 AS median
      FROM "ServiceCase" sc JOIN "WorkItem" w ON w."id" = sc."workItemId"
      WHERE w."status"::text = 'DONE' AND w."closedAt" >= ${from} AND w."closedAt" < ${to} ${assignee}`;

    // Tempo por técnico: registos em assistências com início no período (o que corre conta até agora).
    const technician = query.assigneeId ? Prisma.sql`AND te."userId" = ${query.assigneeId}` : Prisma.empty;
    const timeRows = await this.prisma.$queryRaw<Array<{ userId: string; name: string; total: number; billable: number }>>`
      SELECT te."userId", u."name",
             COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(te."endedAt", now() AT TIME ZONE 'UTC') - te."startedAt"))), 0)::float8 AS total,
             COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(te."endedAt", now() AT TIME ZONE 'UTC') - te."startedAt"))) FILTER (WHERE te."billable"), 0)::float8 AS billable
      FROM "TimeEntry" te
      JOIN "ServiceCase" sc ON sc."workItemId" = te."workItemId"
      JOIN "User" u ON u."id" = te."userId"
      WHERE te."startedAt" >= ${from} AND te."startedAt" < ${to} ${technician}
      GROUP BY te."userId", u."name"
      ORDER BY total DESC, u."name"`;

    // Peças mais usadas no período: as do catálogo agrupadas pelo produto (com o nome e a referência atuais dele); as
    // avulsas pela descrição e referência, sem distinguir maiúsculas, com a escrita da primeira (Fase 5c).
    const partRows = await this.prisma.$queryRaw<Array<{ productId: string | null; description: string; reference: string | null; quantity: number; cases: bigint }>>`
      SELECT p."productId",
             COALESCE(MIN(pr."name"), (array_agg(p."description" ORDER BY p."createdAt", p."id"))[1]) AS description,
             CASE WHEN p."productId" IS NULL THEN (array_agg(p."reference" ORDER BY p."createdAt", p."id"))[1] ELSE MIN(pr."sku") END AS reference,
             SUM(p."quantity")::float8 AS quantity, COUNT(DISTINCT p."serviceCaseId") AS cases
      FROM "ServicePart" p JOIN "WorkItem" w ON w."id" = p."serviceCaseId"
      LEFT JOIN "Product" pr ON pr."id" = p."productId"
      WHERE p."createdAt" >= ${from} AND p."createdAt" < ${to} ${assignee}
      GROUP BY p."productId",
               CASE WHEN p."productId" IS NULL THEN lower(trim(p."description")) END,
               CASE WHEN p."productId" IS NULL THEN lower(trim(coalesce(p."reference", ''))) END
      ORDER BY quantity DESC, description
      LIMIT ${TOP_PARTS}`;

    const hours = (seconds: number | null) => (seconds === null ? null : Math.round((seconds / 3600) * 10) / 10);
    return {
      period: { from, to },
      openTotal: openByStep.reduce((sum, s) => sum + s.count, 0),
      openByStep,
      created,
      resolved,
      notRepaired,
      resolution: { averageHours: hours(resolution?.avg ?? null), medianHours: hours(resolution?.median ?? null) },
      timeByTechnician: timeRows.map((r) => ({ user: { id: r.userId, name: r.name }, totalSeconds: Math.round(r.total), billableSeconds: Math.round(r.billable) })),
      topParts: partRows.map((r) => ({ productId: r.productId, description: r.description, reference: r.reference, quantity: r.quantity, cases: Number(r.cases) })),
    };
  }
}
