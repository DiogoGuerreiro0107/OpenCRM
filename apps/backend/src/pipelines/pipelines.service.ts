import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePipelineDto } from "./dto/create-pipeline.dto";
import { UpdatePipelineDto } from "./dto/update-pipeline.dto";
import { CreateStageDto } from "./dto/create-stage.dto";
import { UpdateStageDto } from "./dto/update-stage.dto";
import { ReorderStagesDto } from "./dto/reorder-stages.dto";

const DEFAULT_STAGES: Array<{ name: string; type: "OPEN" | "WON" | "LOST" }> = [
  { name: "Novo", type: "OPEN" },
  { name: "Em negociação", type: "OPEN" },
  { name: "Ganho", type: "WON" },
  { name: "Perdido", type: "LOST" },
];

@Injectable()
export class PipelinesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.pipeline.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        stages: { orderBy: { order: "asc" }, include: { _count: { select: { deals: true } } } },
      },
    });
  }

  async findOne(id: string) {
    const pipeline = await this.prisma.pipeline.findUnique({
      where: { id },
      include: { stages: { orderBy: { order: "asc" } } },
    });
    if (!pipeline) throw new NotFoundException("Funil não encontrado");
    return pipeline;
  }

  create(dto: CreatePipelineDto) {
    return this.prisma.pipeline.create({
      data: {
        name: dto.name,
        stages: {
          create: DEFAULT_STAGES.map((stage, index) => ({ ...stage, order: index })),
        },
      },
      include: { stages: { orderBy: { order: "asc" } } },
    });
  }

  async update(id: string, dto: UpdatePipelineDto) {
    await this.ensurePipelineExists(id);
    return this.prisma.pipeline.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensurePipelineExists(id);
    await this.prisma.pipeline.delete({ where: { id } });
  }

  async addStage(pipelineId: string, dto: CreateStageDto) {
    await this.ensurePipelineExists(pipelineId);
    const last = await this.prisma.stage.findFirst({
      where: { pipelineId },
      orderBy: { order: "desc" },
    });
    return this.prisma.stage.create({
      data: { name: dto.name, type: dto.type, pipelineId, order: (last?.order ?? -1) + 1 },
    });
  }

  async updateStage(stageId: string, dto: UpdateStageDto) {
    await this.ensureStageExists(stageId);
    return this.prisma.stage.update({ where: { id: stageId }, data: dto });
  }

  async removeStage(stageId: string) {
    const stage = await this.prisma.stage.findUnique({
      where: { id: stageId },
      include: { _count: { select: { deals: true } } },
    });
    if (!stage) throw new NotFoundException("Fase não encontrada");
    if (stage._count.deals > 0) {
      throw new BadRequestException("Move ou elimina os negócios desta fase antes de a eliminar");
    }
    await this.prisma.stage.delete({ where: { id: stageId } });
  }

  async reorderStages(pipelineId: string, dto: ReorderStagesDto) {
    await this.ensurePipelineExists(pipelineId);
    await this.prisma.$transaction(
      dto.stages.map(({ id, order }) =>
        this.prisma.stage.update({ where: { id }, data: { order } }),
      ),
    );
    return this.findOne(pipelineId);
  }

  private async ensurePipelineExists(id: string) {
    const exists = await this.prisma.pipeline.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Funil não encontrado");
  }

  private async ensureStageExists(id: string) {
    const exists = await this.prisma.stage.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Fase não encontrada");
  }
}
