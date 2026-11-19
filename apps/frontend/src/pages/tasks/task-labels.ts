import type { TaskStatus, WorkflowStepCategory } from "@opencrm/shared-types";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em progresso",
  DONE: "Concluída",
  CANCELLED: "Cancelada",
};

/** Categoria de passo que corresponde a um estado (a mesma tradução do servidor: PENDING ↔ OPEN). */
export function categoryForStatus(status: TaskStatus): WorkflowStepCategory {
  return status === "PENDING" ? "OPEN" : status;
}
