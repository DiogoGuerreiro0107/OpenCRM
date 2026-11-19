import type { WorkItemType } from "@opencrm/shared-types";
import { api } from "./api";

/** Tipos de tarefa (Fase 2a): lista curta de configuração, devolvida completa. `activeOnly` para os formulários. */
export async function listWorkItemTypes(activeOnly = false) {
  const { data } = await api.get<WorkItemType[]>("/work-item-types", { params: activeOnly ? { active: "true" } : {} });
  return data;
}

export interface WorkItemTypeInput {
  name: string;
  icon: string;
  color: string;
}

export async function createWorkItemType(input: WorkItemTypeInput) {
  const { data } = await api.post<WorkItemType>("/work-item-types", input);
  return data;
}

export async function updateWorkItemType(id: string, input: Partial<WorkItemTypeInput> & { active?: boolean }) {
  const { data } = await api.patch<WorkItemType>(`/work-item-types/${id}`, input);
  return data;
}

export async function deleteWorkItemType(id: string) {
  await api.delete(`/work-item-types/${id}`);
}

export async function reorderWorkItemTypes(ids: string[]) {
  const { data } = await api.patch<WorkItemType[]>("/work-item-types/order", { ids });
  return data;
}
