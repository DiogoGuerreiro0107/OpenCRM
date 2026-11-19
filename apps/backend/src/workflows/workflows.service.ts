import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { WorkflowOutcome, WorkflowStepCategory } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { StepState } from "./workflow-steps";
import { isWorkflowEntityType, WORKFLOW_ENTITIES, WorkflowEntityType } from "./workflow-registry";

export interface StepInput extends StepState {
  name: string;
}

export interface StepPatch {
  name?: string;
  category?: WorkflowStepCategory;
  outcome?: WorkflowOutcome | null;
}

/**
 * Operações genéricas sobre fluxos e passos (Fase 0c; rotas próprias na 2b). Usadas pelos funis dos negócios
 * (PipelinesService, fachada da API /pipelines), pelos tipos de tarefa e pelas rotas /workflows. Não conhece regras de
 * nenhum tipo de item: isso vem do registo (workflow-registry.ts).
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
  ) {}

  create(entityType: WorkflowEntityType, name: string, steps: StepInput[]) {
    return this.prisma.workflow.create({
      data: { entityType, name, steps: { create: steps.map((step, order) => ({ ...step, order })) } },
    });
  }

  async findWorkflowOrThrow(id: string, entityType: WorkflowEntityType) {
    const workflow = await this.prisma.workflow.findUnique({ where: { id } });
    if (!workflow || workflow.entityType !== entityType) throw new NotFoundException(WORKFLOW_ENTITIES[entityType].messages.notFound);
    return workflow;
  }

  async findStepOrThrow(id: string, entityType: WorkflowEntityType) {
    const step = await this.prisma.workflowStep.findUnique({ where: { id }, include: { workflow: { select: { entityType: true } } } });
    if (!step || step.workflow.entityType !== entityType) throw new NotFoundException(WORKFLOW_ENTITIES[entityType].messages.stepNotFound);
    return step;
  }

  /**
   * Tipo de registo de um fluxo, para as rotas genéricas (que só recebem o id). Um tipo desconhecido ou de um módulo
   * desligado é tratado como se o fluxo não existisse (404), como nas rotas do próprio módulo.
   */
  async entityTypeOfWorkflow(id: string): Promise<WorkflowEntityType> {
    const workflow = await this.prisma.workflow.findUnique({ where: { id }, select: { entityType: true } });
    return this.usableEntityType(workflow?.entityType, "Fluxo não encontrado");
  }

  async entityTypeOfStep(id: string): Promise<WorkflowEntityType> {
    const step = await this.prisma.workflowStep.findUnique({ where: { id }, select: { workflow: { select: { entityType: true } } } });
    return this.usableEntityType(step?.workflow.entityType, "Passo não encontrado");
  }

  private usableEntityType(entityType: string | undefined, notFound: string): WorkflowEntityType {
    if (!isWorkflowEntityType(entityType)) throw new NotFoundException(notFound);
    const module = WORKFLOW_ENTITIES[entityType].module;
    if (module && !this.modules.isEnabled(module)) throw new NotFoundException(notFound);
    return entityType;
  }

  /** Fluxo com os passos (pela ordem) e quantos itens há em cada um. */
  async findOneWithCounts(id: string, entityType: WorkflowEntityType) {
    const entity = WORKFLOW_ENTITIES[entityType];
    const workflow = await this.prisma.workflow.findUnique({ where: { id }, include: { steps: { orderBy: { order: "asc" } } } });
    if (!workflow || workflow.entityType !== entityType) throw new NotFoundException(entity.messages.notFound);
    const counts = await Promise.all(workflow.steps.map((s) => entity.countItems(this.prisma, s.id)));
    return {
      id: workflow.id,
      entityType: workflow.entityType,
      name: workflow.name,
      steps: workflow.steps.map((s, i) => ({ id: s.id, name: s.name, order: s.order, category: s.category, outcome: s.outcome, itemCount: counts[i] })),
    };
  }

  async addStep(workflowId: string, entityType: WorkflowEntityType, step: StepInput) {
    await this.findWorkflowOrThrow(workflowId, entityType);
    this.assertStepState(entityType, step);
    const last = await this.prisma.workflowStep.findFirst({ where: { workflowId }, orderBy: { order: "desc" } });
    return this.prisma.workflowStep.create({ data: { ...step, workflowId, order: (last?.order ?? -1) + 1 } });
  }

  /**
   * Muda nome, categoria ou resultado. Uma categoria que não seja DONE apaga o resultado (só os concluídos o têm). Se a
   * categoria ou o resultado mudarem, o registo acerta os itens desse passo na mesma transação (nas tarefas: o estado).
   */
  async updateStep(stepId: string, entityType: WorkflowEntityType, patch: StepPatch) {
    const current = await this.findStepOrThrow(stepId, entityType);
    const category = patch.category ?? current.category;
    const outcome = category === "DONE" ? (patch.outcome !== undefined ? patch.outcome : current.outcome) : null;
    this.assertStepState(entityType, { category, outcome });
    const stateChanged = category !== current.category || outcome !== current.outcome;

    return this.prisma.$transaction(async (tx) => {
      const step = await tx.workflowStep.update({
        where: { id: stepId },
        data: { ...(patch.name !== undefined ? { name: patch.name } : {}), category, outcome },
      });
      if (stateChanged) await WORKFLOW_ENTITIES[entityType].onStepStateChanged(tx, stepId, { category, outcome });
      return step;
    });
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
   * esse passo (do MESMO fluxo) e o passo é apagado, tudo na mesma transação. O último passo de um fluxo não se apaga.
   */
  async removeStep(stepId: string, entityType: WorkflowEntityType, moveToStepId?: string) {
    const entity = WORKFLOW_ENTITIES[entityType];
    const step = await this.findStepOrThrow(stepId, entityType);

    await this.prisma.$transaction(async (tx) => {
      const siblings = await tx.workflowStep.count({ where: { workflowId: step.workflowId } });
      if (siblings <= 1) throw new BadRequestException(entity.messages.lastStep);
      const count = await entity.countItems(tx, stepId);
      if (count > 0) {
        if (!moveToStepId) throw new BadRequestException(entity.messages.stepHasItems(count));
        if (moveToStepId === stepId) throw new BadRequestException(entity.messages.targetIsSame);
        const target = await tx.workflowStep.findUnique({ where: { id: moveToStepId } });
        if (!target || target.workflowId !== step.workflowId) throw new BadRequestException(entity.messages.targetOtherWorkflow);
        await entity.moveItems(tx, stepId, target);
      }
      await tx.workflowStep.delete({ where: { id: stepId } });
    });
  }

  /** Resultado só em passos concluídos (há também uma restrição CHECK) e só nos tipos que o usam. */
  private assertStepState(entityType: WorkflowEntityType, state: StepState) {
    if (!state.outcome) return;
    if (!WORKFLOW_ENTITIES[entityType].allowsOutcome) throw new BadRequestException(`Os passos de ${WORKFLOW_ENTITIES[entityType].label.toLowerCase()} não têm resultado`);
    if (state.category !== "DONE") throw new BadRequestException("Só um passo concluído pode ter resultado");
  }
}
