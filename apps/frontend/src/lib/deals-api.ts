import type { Deal } from "@opencrm/shared-types";
import { api } from "./api";

export interface DealInput {
  title: string;
  pipelineId: string;
  stageId: string;
  value?: number;
  probability?: number;
  contactId?: string;
  companyId?: string;
}

export async function listDeals(pipelineId: string) {
  const { data } = await api.get<Deal[]>("/deals", { params: { pipelineId } });
  return data;
}

export async function createDeal(input: DealInput) {
  const { data } = await api.post<Deal>("/deals", input);
  return data;
}

export async function updateDeal(id: string, input: Partial<Omit<DealInput, "pipelineId" | "stageId">>) {
  const { data } = await api.patch<Deal>(`/deals/${id}`, input);
  return data;
}

export async function moveDeal(id: string, stageId: string, index: number) {
  const { data } = await api.patch<Deal>(`/deals/${id}/move`, { stageId, index });
  return data;
}

export async function deleteDeal(id: string) {
  await api.delete(`/deals/${id}`);
}
