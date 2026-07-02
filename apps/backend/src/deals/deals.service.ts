import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { CreateDealDto } from "./dto/create-deal.dto";
import { UpdateDealDto } from "./dto/update-deal.dto";
import { MoveDealDto } from "./dto/move-deal.dto";

const DEAL_INCLUDE = {
  contact: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
} as const;

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  findAllByPipeline(pipelineId: string) {
    return this.prisma.deal.findMany({
      where: { pipelineId },
      orderBy: { order: "asc" },
      include: DEAL_INCLUDE,
    });
  }

  async findOne(id: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: DEAL_INCLUDE });
    if (!deal) throw new NotFoundException("Negócio não encontrado");
    return deal;
  }

  async create(dto: CreateDealDto, ownerId: string) {
    const stage = await this.prisma.stage.findUnique({ where: { id: dto.stageId } });
    if (!stage) throw new NotFoundException("Fase não encontrada");
    if (stage.pipelineId !== dto.pipelineId) {
      throw new BadRequestException("A fase indicada não pertence a este funil");
    }

    const last = await this.prisma.deal.findFirst({
      where: { stageId: dto.stageId },
      orderBy: { order: "desc" },
    });

    const deal = await this.prisma.deal.create({
      data: {
        title: dto.title,
        value: dto.value ?? 0,
        probability: dto.probability ?? 0,
        pipelineId: dto.pipelineId,
        stageId: dto.stageId,
        contactId: dto.contactId,
        companyId: dto.companyId,
        ownerId,
        order: (last?.order ?? -1) + 1,
        closedAt: stage.type === "OPEN" ? null : new Date(),
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
    await this.ensureExists(id);
    return this.prisma.deal.update({ where: { id }, data: dto, include: DEAL_INCLUDE });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.deal.delete({ where: { id } });
  }

  async move(id: string, dto: MoveDealDto) {
    const deal = await this.prisma.deal.findUnique({ where: { id }, include: { stage: true } });
    if (!deal) throw new NotFoundException("Negócio não encontrado");

    const targetStage = await this.prisma.stage.findUnique({ where: { id: dto.stageId } });
    if (!targetStage) throw new NotFoundException("Fase não encontrada");
    if (targetStage.pipelineId !== deal.pipelineId) {
      throw new BadRequestException("A fase indicada não pertence ao funil deste negócio");
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
          closedAt: targetStage.type === "OPEN" ? null : (deal.closedAt ?? new Date()),
        },
      }),
      ...orderedIds.map((dealId, index) =>
        this.prisma.deal.update({ where: { id: dealId }, data: { order: index } }),
      ),
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
        toStageType: targetStage.type,
      });
    }

    return this.findOne(id);
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.deal.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Negócio não encontrado");
  }
}
