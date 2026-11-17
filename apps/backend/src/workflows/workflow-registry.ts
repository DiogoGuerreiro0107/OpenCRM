import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ModuleId } from "../modules/module-manifest";
import { isOpenStep, StepState } from "./workflow-steps";

/**
 * Tipos de coisa que passam por fluxos (Fase 0c). Hoje só negócios; um módulo novo (assistências, encomendas...)
 * junta aqui uma linha: a que módulo pertence, como contar os itens num passo e como movê-los para outro passo
 * (usado ao apagar um passo com itens). Um teste estrutural garante que cada linha está completa.
 */
export interface WorkflowEntity {
  label: string;
  /** Nome no singular, para mensagens («negócio»). */
  itemName: string;
  module: ModuleId | null;
  countItems: (tx: Prisma.TransactionClient, stepId: string) => Promise<number>;
  /** Move todos os itens de um passo para outro (dentro de uma transação). Lança 400 se a regra do tipo o impedir. */
  moveItems: (tx: Prisma.TransactionClient, fromStepId: string, to: { id: string } & StepState) => Promise<number>;
}

export const WORKFLOW_ENTITIES = {
  DEAL: {
    label: "Negócios",
    itemName: "negócio",
    module: "deals",
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
  },
} satisfies Record<string, WorkflowEntity>;

export type WorkflowEntityType = keyof typeof WORKFLOW_ENTITIES;

export const WORKFLOW_ENTITY_TYPES = Object.keys(WORKFLOW_ENTITIES) as WorkflowEntityType[];

export const isWorkflowEntityType = (value: unknown): value is WorkflowEntityType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(WORKFLOW_ENTITIES, value);
