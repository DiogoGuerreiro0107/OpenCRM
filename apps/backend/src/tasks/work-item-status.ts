import { WorkItemStatus } from "@prisma/client";

/**
 * Estados «em aberto» de um item de trabalho: o que conta para atrasadas, de hoje, dashboard e a regra de automação
 * «tarefas do negócio concluídas». Concluída e cancelada estão fechadas (Fase 2a).
 */
export const OPEN_WORK_ITEM_STATUSES: WorkItemStatus[] = ["PENDING", "IN_PROGRESS"];

export const isOpenStatus = (status: WorkItemStatus) => OPEN_WORK_ITEM_STATUSES.includes(status);
