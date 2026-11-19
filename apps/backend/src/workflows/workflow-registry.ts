import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ModuleId } from "../modules/module-manifest";
import { isOpenStep, StepState } from "./workflow-steps";
import { statusForCategory } from "../tasks/work-item-status";

/**
 * Tipos de coisa que passam por fluxos (Fase 0c; tarefas na 2b). Um módulo novo (assistências, encomendas...) junta
 * aqui uma linha: a que módulo pertence, se os passos podem ter resultado, como contar os itens num passo, como
 * movê-los para outro passo (ao apagar um passo com itens), o que fazer quando a categoria de um passo muda e as
 * palavras das mensagens. Um teste estrutural garante que cada linha está completa.
 */
export interface WorkflowEntity {
  label: string;
  /** Nome no singular, para mensagens («negócio»). */
  itemName: string;
  module: ModuleId | null;
  /** Os passos concluídos podem ter resultado (ganho/perdido)? */
  allowsOutcome: boolean;
  countItems: (tx: Prisma.TransactionClient, stepId: string) => Promise<number>;
  /** Move todos os itens de um passo para outro (dentro de uma transação). Lança 400 se a regra do tipo o impedir. */
  moveItems: (tx: Prisma.TransactionClient, fromStepId: string, to: { id: string } & StepState) => Promise<number>;
  /** A categoria/resultado de um passo mudou (dentro da mesma transação): acertar o que deriva dela nos itens. */
  onStepStateChanged: (tx: Prisma.TransactionClient, stepId: string, state: StepState) => Promise<void>;
  messages: {
    notFound: string;
    stepNotFound: string;
    stepHasItems: (count: number) => string;
    targetIsSame: string;
    targetOtherWorkflow: string;
    lastStep: string;
  };
}

export const WORKFLOW_ENTITIES = {
  DEAL: {
    label: "Negócios",
    itemName: "negócio",
    module: "deals",
    allowsOutcome: true,
    countItems: (tx, stepId) => tx.deal.count({ where: { stageId: stepId } }),
    moveItems: async (tx, fromStepId, to) => {
      const now = new Date();
      // Regra dos negócios: entrar numa fase de perda exige motivo de perda.
      if (to.outcome === "LOST") {
        const withoutReason = await tx.deal.count({ where: { stageId: fromStepId, lossReason: null } });
        if (withoutReason > 0) {
          throw new BadRequestException(
            `${withoutReason} negócio(s) sem motivo de perda não podem ir para uma fase de perda. Escolhe outra fase de destino.`,
          );
        }
      }
      if (isOpenStep(to)) {
        const moved = await tx.deal.updateMany({ where: { stageId: fromStepId }, data: { stageId: to.id, stageEnteredAt: now, closedAt: null } });
        return moved.count;
      }
      // Fecho: quem ainda não tinha data de fecho fica com a de agora; quem já tinha mantém-na (como ao mover um a um).
      await tx.deal.updateMany({ where: { stageId: fromStepId, closedAt: null }, data: { closedAt: now } });
      const moved = await tx.deal.updateMany({ where: { stageId: fromStepId }, data: { stageId: to.id, stageEnteredAt: now } });
      return moved.count;
    },
    // Como antes da 2b: mudar o tipo de uma fase não reabre nem fecha os negócios que lá estão.
    onStepStateChanged: async () => {},
    messages: {
      notFound: "Funil não encontrado",
      stepNotFound: "Fase não encontrada",
      stepHasItems: (count) => `Esta fase tem ${count} negócio(s). Escolhe para que fase os mover antes de a eliminar.`,
      targetIsSame: "A fase de destino não pode ser a que vai ser eliminada",
      targetOtherWorkflow: "A fase de destino tem de ser do mesmo funil",
      lastStep: "Um funil tem de ter pelo menos uma fase",
    },
  },
  /** Passos dos tipos de tarefa (Fase 2b). O estado do item deriva da categoria do passo (work-item-status.ts). */
  WORK_ITEM: {
    label: "Tarefas",
    itemName: "tarefa",
    module: null,
    allowsOutcome: false,
    countItems: (tx, stepId) => tx.workItem.count({ where: { stepId } }),
    moveItems: async (tx, fromStepId, to) => {
      const moved = await tx.workItem.updateMany({ where: { stepId: fromStepId }, data: { stepId: to.id, status: statusForCategory(to.category) } });
      return moved.count;
    },
    onStepStateChanged: async (tx, stepId, state) => {
      await tx.workItem.updateMany({ where: { stepId }, data: { status: statusForCategory(state.category) } });
    },
    messages: {
      notFound: "Fluxo não encontrado",
      stepNotFound: "Passo não encontrado",
      stepHasItems: (count) => `Este passo tem ${count} tarefa(s). Escolhe para que passo as mover antes de o eliminar.`,
      targetIsSame: "O passo de destino não pode ser o que vai ser eliminado",
      targetOtherWorkflow: "O passo de destino tem de ser do mesmo tipo de tarefa",
      lastStep: "Um tipo com passos tem de ter pelo menos um passo (para deixar de os ter, usa «Tirar os passos»)",
    },
  },
} satisfies Record<string, WorkflowEntity>;

export type WorkflowEntityType = keyof typeof WORKFLOW_ENTITIES;

export const WORKFLOW_ENTITY_TYPES = Object.keys(WORKFLOW_ENTITIES) as WorkflowEntityType[];

export const isWorkflowEntityType = (value: unknown): value is WorkflowEntityType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(WORKFLOW_ENTITIES, value);
