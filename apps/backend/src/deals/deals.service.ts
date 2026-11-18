import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import { foldSearch } from "../common/search-text";
import { DealFiltersDto, QueryDealsDto } from "./dto/query-deals.dto";
import { WebhooksService } from "../webhooks/webhooks.service";
import { AutomationsService } from "../automations/automations.service";
import { CreateDealDto } from "./dto/create-deal.dto";
import { UpdateDealDto } from "./dto/update-deal.dto";
import { MoveDealDto } from "./dto/move-deal.dto";
import { isOpenStep, stageTypeOf } from "../workflows/workflow-steps";

const DEAL_INCLUDE = {
  contact: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} as const;

/** Ordem de uma coluna do quadro (order, id): cursor e ordem dos cartões. */
const COLUMN_KEY: KeyField[] = [
  { field: "order", dir: "asc", kind: "number" },
  { field: "id", dir: "asc", kind: "string" },
];

const WATCHED_FIELDS = ["value", "probability", "type", "estimatedMargin"] as const;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly automations: AutomationsService,
  ) {}

  private boardWhere(filters: DealFiltersDto): Prisma.DealWhereInput {
    const where: Prisma.DealWhereInput = { pipelineId: filters.pipelineId };
    const term = filters.search ? foldSearch(filters.search.trim()) : "";
    // searchText = título + texto de pesquisa da empresa e do contacto, sem acentos, mantido por triggers (também quando
    // a empresa ou o contacto mudam); «contém» usa só o índice pg_trgm do negócio.
    if (term) where.searchText = { contains: term };
    return where;
  }

  /** Cartões de um funil (normalmente de uma coluna), paginados pela ordem da coluna. */
  findPage(query: QueryDealsDto) {
    const where = this.boardWhere(query);
    if (query.stageId) where.stageId = query.stageId;
    return readPage(COLUMN_KEY, query, (after, take) =>
      this.prisma.deal.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(COLUMN_KEY), take, include: DEAL_INCLUDE }),
    );
  }

  /** Número de negócios e valor total por fase, com os mesmos filtros do quadro (cabeçalho de cada coluna). */
  async summary(filters: DealFiltersDto) {
    const grouped = await this.prisma.deal.groupBy({ by: ["stageId"], where: this.boardWhere(filters), _count: true, _sum: { value: true } });
    return grouped.map((g) => ({ stageId: g.stageId, count: g._count, totalValue: g._sum.value ?? 0 }));
  }

  async findOne(id: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: DEAL_INCLUDE });
    if (!deal) throw new NotFoundException("Negócio não encontrado");
    return deal;
  }

  async create(dto: CreateDealDto, ownerId: string) {
    const stage = await this.prisma.workflowStep.findUnique({ where: { id: dto.stageId }, include: { workflow: { select: { entityType: true } } } });
    if (!stage || stage.workflow.entityType !== "DEAL") throw new NotFoundException("Fase não encontrada");
    if (stage.workflowId !== dto.pipelineId) {
      throw new BadRequestException("A fase indicada não pertence a este funil");
    }

    // Os negócios novos entram no TOPO da coluna: aparecem logo, mesmo numa coluna com muitas páginas.
    const first = await this.prisma.deal.findFirst({
      where: { stageId: dto.stageId },
      orderBy: { order: "asc" },
      select: { order: true },
    });

    const deal = await this.prisma.deal.create({
      data: {
        title: dto.title,
        value: dto.value ?? 0,
        probability: dto.probability ?? 0,
        type: dto.type,
        estimatedMargin: dto.estimatedMargin,
        lossReason: dto.lossReason,
        pipelineId: dto.pipelineId,
        stageId: dto.stageId,
        contactId: dto.contactId,
        companyId: dto.companyId,
        ownerId,
        order: (first?.order ?? 1) - 1,
        closedAt: isOpenStep(stage) ? null : new Date(),
      },
      include: DEAL_INCLUDE,
    });

    this.webhooks.trigger("deal.created", {
      dealId: deal.id,
      title: deal.title,
      value: deal.value,
      pipelineId: deal.pipelineId,
      stageId: deal.stageId,
      stageName: stage.name,
    });

    return deal;
  }

  async update(id: string, dto: UpdateDealDto) {
    const existing = await this.prisma.deal.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Negócio não encontrado");

    const deal = await this.prisma.deal.update({ where: { id }, data: dto, include: DEAL_INCLUDE });

    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const field of WATCHED_FIELDS) {
      if (dto[field] !== undefined && dto[field] !== existing[field]) {
        changes[field] = { before: existing[field], after: dto[field] };
      }
    }
    if (Object.keys(changes).length > 0) {
      await this.automations.evaluateFieldChangedRules(id, deal.pipelineId, changes);
    }

    return deal;
  }

  async remove(id: string) {
    await this.ensureExists(id);
    // Os valores dos campos personalizados não têm chave estrangeira (polimórficos): apagam-se juntamente.
    await this.prisma.$transaction([
      this.prisma.customFieldValue.deleteMany({ where: { entityType: "DEAL", entityId: id } }),
      this.prisma.deal.delete({ where: { id } }),
    ]);
  }

  async move(id: string, dto: MoveDealDto) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: { stage: true } });
    if (!deal) throw new NotFoundException("Negócio não encontrado");

    const targetStage = await this.prisma.workflowStep.findUnique({ where: { id: dto.stageId } });
    if (!targetStage) throw new NotFoundException("Fase não encontrada");
    if (targetStage.workflowId !== deal.pipelineId) {
      throw new BadRequestException("A fase indicada não pertence ao funil deste negócio");
    }

    if (stageTypeOf(targetStage) === "LOST" && !dto.lossReason && !deal.lossReason) {
      throw new BadRequestException("O motivo de perda é obrigatório ao mover um negócio para uma fase perdida");
    }

    const siblings = await this.prisma.deal.findMany({
      where: { stageId: dto.stageId, id: { not: id } },
      orderBy: { order: "asc" },
      select: { id: true },
    });

    const orderedIds = siblings.map((s) => s.id);
    const insertAt = Math.min(dto.index, orderedIds.length);
    orderedIds.splice(insertAt, 0, id);

    await this.prisma.$transaction([
      this.prisma.deal.update({
        where: { id },
        data: {
          stageId: dto.stageId,
          closedAt: isOpenStep(targetStage) ? null : (deal.closedAt ?? new Date()),
          lossReason: dto.lossReason ?? undefined,
          stageEnteredAt: deal.stageId !== dto.stageId ? new Date() : undefined,
        },
      }),
      // Renumera a coluna numa só instrução e só as linhas cuja posição muda. Sem passar pelo Prisma, o updatedAt dos
      // outros negócios não mexe (conta para as «oportunidades paradas» do dashboard).
      this.prisma.$executeRaw`
        UPDATE "Deal" AS d SET "order" = (v.ord - 1)::int
        FROM unnest(${orderedIds}::text[]) WITH ORDINALITY AS v(id, ord)
        WHERE d.id = v.id AND d."order" <> (v.ord - 1)::int`,
    ]);

    if (deal.stageId !== dto.stageId) {
      this.webhooks.trigger("deal.stage_changed", {
        dealId: deal.id,
        title: deal.title,
        pipelineId: deal.pipelineId,
        fromStageId: deal.stageId,
        fromStageName: deal.stage.name,
        toStageId: targetStage.id,
        toStageName: targetStage.name,
        toStageType: stageTypeOf(targetStage),
      });

      if (targetStage.name.trim().toLowerCase() === "proposta enviada") {
        this.webhooks.trigger("deal.proposal_sent", {
          dealId: deal.id,
          title: deal.title,
          pipelineId: deal.pipelineId,
          stageId: targetStage.id,
        });
      }
    }

    return this.findOne(id);
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.deal.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Negócio não encontrado");
  }
}
