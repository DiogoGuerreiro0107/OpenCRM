import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Workflow, WorkflowStep } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { StageType, stageTypeOf, stepStateFor } from "../workflows/workflow-steps";
import { CreatePipelineDto } from "./dto/create-pipeline.dto";
import { UpdatePipelineDto } from "./dto/update-pipeline.dto";
import { CreateStageDto } from "./dto/create-stage.dto";
import { UpdateStageDto } from "./dto/update-stage.dto";
import { ReorderStagesDto } from "./dto/reorder-stages.dto";

/**
 * Funis dos negócios = fluxos genéricos com `entityType` "DEAL" (Fase 0c). Esta classe é a FACHADA que mantém a API
 * `/pipelines` e `/stages` exatamente como antes (`stages`, `type` OPEN/WON/LOST, `pipelineId`), traduzindo de e
 * para categoria + resultado. As respostas ganham `category` e `outcome` (só acrescenta).
 */
const ENTITY = "DEAL" as const;

const DEFAULT_STAGES: Array<{ name: string; type: StageType }> = [
  { name: "Novo", type: "OPEN" },
  { name: "Em negociação", type: "OPEN" },
  { name: "Ganho", type: "WON" },
  { name: "Perdido", type: "LOST" },
];

type StepWithCount = WorkflowStep & { _count?: { deals: number } };

/** Fase como a API dos negócios sempre a mostrou, mais a categoria e o resultado. */
export function stageView(step: StepWithCount) {
  return {
    id: step.id,
    name: step.name,
    order: step.order,
    type: stageTypeOf(step),
    category: step.category,
    outcome: step.outcome,
    pipelineId: step.workflowId,
    ...(step._count ? { _count: step._count } : {}),
  };
}

function pipelineView(workflow: Workflow & { steps: StepWithCount[] }) {
  return {
    id: workflow.id,
    name: workflow.name,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    stages: workflow.steps.map(stageView),
  };
}

@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  async findAll() {
    const workflows = await this.prisma.workflow.findMany({
      where: { entityType: ENTITY },
      orderBy: { createdAt: "asc" },
      include: { steps: { orderBy: { order: "asc" }, include: { _count: { select: { deals: true } } } } },
    });
    return workflows.map(pipelineView);
  }

  async findOne(id: string) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id },
      include: { steps: { orderBy: { order: "asc" } } },
    });
    if (!workflow || workflow.entityType !== ENTITY) throw new NotFoundException("Funil não encontrado");
    return pipelineView(workflow);
  }

  async create(dto: CreatePipelineDto) {
    const created = await this.workflows.create(
      ENTITY,
      dto.name,
      DEFAULT_STAGES.map(({ name, type }) => ({ name, ...stepStateFor(type) })),
    );
    return this.findOne(created.id);
  }

  async update(id: string, dto: UpdatePipelineDto) {
    await this.workflows.findWorkflowOrThrow(id, ENTITY).catch(() => {
      throw new NotFoundException("Funil não encontrado");
    });
    const updated = await this.prisma.workflow.update({ where: { id }, data: { name: dto.name } });
    return { id: updated.id, name: updated.name, createdAt: updated.createdAt, updatedAt: updated.updatedAt };
  }

  async remove(id: string) {
    const workflow = await this.prisma.workflow.findUnique({ where: { id }, include: { _count: { select: { deals: true } } } });
    if (!workflow || workflow.entityType !== ENTITY) throw new NotFoundException("Funil não encontrado");
    if (workflow._count.deals > 0) {
      throw new BadRequestException("Move ou elimina os negócios deste funil antes de o eliminar");
    }
    await this.prisma.workflow.delete({ where: { id } });
  }

  async addStage(pipelineId: string, dto: CreateStageDto) {
    await this.ensurePipeline(pipelineId);
    const step = await this.workflows.addStep(pipelineId, ENTITY, { name: dto.name, ...stepStateFor(dto.type ?? "OPEN") });
    return stageView(step);
  }

  async updateStage(stageId: string, dto: UpdateStageDto) {
    await this.ensureStage(stageId);
    const step = await this.workflows.updateStep(stageId, ENTITY, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.type !== undefined ? stepStateFor(dto.type) : {}),
    });
    return stageView(step);
  }

  /** Com `moveTo`, os negócios da fase passam para essa fase (do mesmo funil) antes de a apagar. */
  async removeStage(stageId: string, moveTo?: string) {
    await this.ensureStage(stageId);
    await this.workflows.removeStep(stageId, ENTITY, moveTo);
  }

  async reorderStages(pipelineId: string, dto: ReorderStagesDto) {
    await this.ensurePipeline(pipelineId);
    await this.workflows.reorderSteps(pipelineId, ENTITY, dto.stages);
    return this.findOne(pipelineId);
  }

  /** Mantém as mensagens de sempre («Funil/Fase não encontrado/a»). */
  private async ensurePipeline(id: string) {
    await this.workflows.findWorkflowOrThrow(id, ENTITY).catch(() => {
      throw new NotFoundException("Funil não encontrado");
    });
  }

  private async ensureStage(id: string) {
    await this.workflows.findStepOrThrow(id, ENTITY).catch(() => {
      throw new NotFoundException("Fase não encontrada");
    });
  }
}
