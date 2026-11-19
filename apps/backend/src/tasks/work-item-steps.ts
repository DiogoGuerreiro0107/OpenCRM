import { BadRequestException } from "@nestjs/common";
import { Prisma, WorkItemStatus } from "@prisma/client";
import { categoryForStatus, statusForCategory } from "./work-item-status";

/** Nomes das categorias nas mensagens. */
const CATEGORY_LABELS = { OPEN: "por fazer", IN_PROGRESS: "em curso", DONE: "concluída", CANCELLED: "cancelada" } as const;

export interface StepRequest {
  typeId: string;
  /** Passo pedido explicitamente (tem de ser do fluxo do tipo). */
  stepId?: string | null;
  /** Estado pedido (num tipo com passos, escolhe o primeiro passo desta categoria). */
  status?: WorkItemStatus;
  /** Passo atual do item (ao editar): fica, se for deste fluxo e da categoria pedida. */
  currentStepId?: string | null;
}

export interface ResolvedStep {
  stepId: string | null;
  /** Estado a gravar; `undefined` = não mexer (tipo sem passos e nenhum estado pedido). */
  status: WorkItemStatus | undefined;
}

/**
 * Regras do passo de um item de trabalho (Fase 2b, docs/plano-fase-2-itens-de-trabalho.md), usadas por quem cria ou
 * altera itens (tarefas, leads). Num tipo SEM passos, o item não tem passo e o estado é o pedido. Num tipo COM passos:
 *  - `stepId` tem de ser um passo do fluxo do tipo, e o estado passa a ser o da categoria dele;
 *  - sem `stepId`, fica no passo atual se ele for deste fluxo e da categoria do estado pedido (ou de `fallbackStatus`:
 *    o estado atual do item, ou PENDING num item novo); senão vai para o primeiro passo (pela ordem) dessa categoria;
 *  - `stepId` e `status` juntos têm de bater certo.
 */
export async function resolveWorkItemStep(
  tx: Prisma.TransactionClient,
  request: StepRequest,
  fallbackStatus: WorkItemStatus = "PENDING",
): Promise<ResolvedStep> {
  const type = await tx.workItemType.findUnique({
    where: { id: request.typeId },
    select: { workflowId: true, workflow: { select: { steps: { orderBy: { order: "asc" }, select: { id: true, category: true } } } } },
  });
  if (!type) throw new BadRequestException("Tipo de tarefa desconhecido");
  if (!type.workflow) {
    if (request.stepId) throw new BadRequestException("Este tipo de tarefa não tem passos");
    return { stepId: null, status: request.status };
  }

  const steps = type.workflow.steps;
  if (request.stepId) {
    const step = steps.find((s) => s.id === request.stepId);
    if (!step) throw new BadRequestException("O passo indicado não é deste tipo de tarefa");
    const status = statusForCategory(step.category);
    if (request.status && request.status !== status) {
      throw new BadRequestException("O estado não corresponde ao passo indicado");
    }
    return { stepId: step.id, status };
  }

  const wanted = categoryForStatus(request.status ?? fallbackStatus);
  const current = steps.find((s) => s.id === request.currentStepId && s.category === wanted);
  const step = current ?? steps.find((s) => s.category === wanted);
  if (!step) throw new BadRequestException(`Este tipo de tarefa não tem nenhum passo «${CATEGORY_LABELS[wanted]}»`);
  return { stepId: step.id, status: statusForCategory(step.category) };
}
