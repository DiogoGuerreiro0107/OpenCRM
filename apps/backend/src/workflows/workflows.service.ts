import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StepState } from "./workflow-steps";
import { WORKFLOW_ENTITIES, WorkflowEntityType } from "./workflow-registry";

export interface StepInput extends StepState {
  name: string;
}

/**
 * Operações genéricas sobre fluxos e passos (Fase 0c). Hoje usadas pelos funis dos negócios (PipelinesService); os
 * módulos futuros usam-nas com o seu `entityType`. Não conhece regras de nenhum tipo de item: isso vem do registo.
 */
@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  create(entityType: WorkflowEntityType, name: string, steps: StepInput[]) {
    return this.prisma.workflow.create({
      data: { entityType, name, steps: { create: steps.map((step, order) => ({ ...step, order })) } },
    });
  }

  async findWorkflowOrThrow(id: string, entityType: WorkflowEntityType) {
    const workflow = await this.prisma.workflow.findUnique({ where: { id } });
    if (!workflow || workflow.entityType !== entityType) throw new NotFoundException("Fluxo não encontrado");
    return workflow;
  }

  async findStepOrThrow(id: string, entityType: WorkflowEntityType) {
    const step = await this.prisma.workflowStep.findUnique({ where: { id }, include: { workflow: { select: { entityType: true } } } });
    if (!step || step.workflow.entityType !== entityType) throw new NotFoundException("Passo não encontrado");
    return step;
  }

  async addStep(workflowId: string, entityType: WorkflowEntityType, step: StepInput) {
    await this.findWorkflowOrThrow(workflowId, entityType);
    const last = await this.prisma.workflowStep.findFirst({ where: { workflowId }, orderBy: { order: "desc" } });
    return this.prisma.workflowStep.create({ data: { ...step, workflowId, order: (last?.order ?? -1) + 1 } });
  }

  async updateStep(stepId: string, entityType: WorkflowEntityType, data: Partial<StepInput>) {
    await this.findStepOrThrow(stepId, entityType);
    return this.prisma.workflowStep.update({ where: { id: stepId }, data });
  }

  /** Reordena: todos os ids têm de ser passos deste fluxo (antes, ids de outro funil eram aceites em silêncio). */
  async reorderSteps(workflowId: string, entityType: WorkflowEntityType, order: Array<{ id: string; order: number }>) {
    await this.findWorkflowOrThrow(workflowId, entityType);
    const owned = await this.prisma.workflowStep.count({ where: { workflowId, id: { in: order.map((o) => o.id) } } });
    if (owned !== order.length) throw new BadRequestException("Há passos que não pertencem a este fluxo");
    await this.prisma.$transaction(order.map(({ id, order: position }) => this.prisma.workflowStep.update({ where: { id }, data: { order: position } })));
  }

  /**
   * Apaga um passo. Se tiver itens: sem `moveToStepId` é recusado (com a contagem); com ele, os itens passam para
   * esse passo (do MESMO fluxo) e o passo é apagado, tudo na mesma transação.
   */
  async removeStep(stepId: string, entityType: WorkflowEntityType, moveToStepId?: string) {
    const entity = WORKFLOW_ENTITIES[entityType];
    const step = await this.findStepOrThrow(stepId, entityType);

    await this.prisma.$transaction(async (tx) => {
      const count = await entity.countItems(tx, stepId);
      if (count > 0) {
        if (!moveToStepId) {
          throw new BadRequestException(
            `Esta fase tem ${count} ${entity.itemName}(s). Escolhe para que fase os mover antes de a eliminar.`,
          );
        }
        if (moveToStepId === stepId) throw new BadRequestException("A fase de destino não pode ser a que vai ser eliminada");
        const target = await tx.workflowStep.findUnique({ where: { id: moveToStepId } });
        if (!target || target.workflowId !== step.workflowId) throw new BadRequestException("A fase de destino tem de ser do mesmo funil");
        await entity.moveItems(tx, stepId, target);
      }
      await tx.workflowStep.delete({ where: { id: stepId } });
    });
  }
}
