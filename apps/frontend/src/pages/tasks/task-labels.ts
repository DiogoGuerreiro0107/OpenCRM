import type { TaskStatus } from "@opencrm/shared-types";

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em progresso",
  DONE: "Concluída",
  CANCELLED: "Cancelada",
};
