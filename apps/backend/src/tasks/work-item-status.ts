import { WorkItemStatus, WorkflowStepCategory } from "@prisma/client";

/**
 * Estados «em aberto» de um item de trabalho: o que conta para atrasadas, de hoje, dashboard e a regra de automação
 * «tarefas do negócio concluídas». Concluída e cancelada estão fechadas (Fase 2a).
 */
export const OPEN_WORK_ITEM_STATUSES: WorkItemStatus[] = ["PENDING", "IN_PROGRESS"];

export const isOpenStatus = (status: WorkItemStatus) => OPEN_WORK_ITEM_STATUSES.includes(status);

/**
 * Estado de um item num passo de categoria `category` (Fase 2b): OPEN → PENDING; as outras têm o mesmo nome. É a
 * mesma tradução que o trigger "WorkItem_passo_coerente" confirma na base de dados.
 */
export function statusForCategory(category: WorkflowStepCategory): WorkItemStatus {
  return category === "OPEN" ? "PENDING" : category;
}

/** Categoria de passo que corresponde a um estado (o inverso de `statusForCategory`). */
export function categoryForStatus(status: WorkItemStatus): WorkflowStepCategory {
  return status === "PENDING" ? "OPEN" : status;
}
