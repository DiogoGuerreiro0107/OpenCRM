import type { Page, ServiceCase, ServiceIndicators, ServicePart, ServiceWarranty, TaskPriority } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";

/** Assistências (módulo assistencias, Fase 4a). A tarefa (passo, estado, responsável, prazo) edita-se em /tasks/:id. */

export interface ServiceCaseFilters {
  search?: string;
  state?: "open" | "closed";
  stepId?: string;
  assigneeId?: string;
  companyId?: string;
  contactId?: string;
}

export async function listServiceCases(filters: ServiceCaseFilters & PageParams) {
  const { data } = await api.get<Page<ServiceCase>>("/service-cases", { params: filters });
  return data;
}

export async function getServiceCase(id: string) {
  const { data } = await api.get<ServiceCase>(`/service-cases/${id}`);
  return data;
}

export interface NewServiceCase {
  title?: string;
  reportedProblem: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  underWarranty?: ServiceWarranty;
  companyId?: string;
  contactId?: string;
  assigneeId?: string;
  dueDate?: string;
  priority?: TaskPriority;
}

export async function createServiceCase(input: NewServiceCase) {
  const { data } = await api.post<ServiceCase>("/service-cases", input);
  return data;
}

export type ServiceCaseChanges = Partial<Pick<ServiceCase, "brand" | "model" | "serialNumber" | "underWarranty" | "reportedProblem" | "diagnosis" | "resolution">>;

export async function updateServiceCase(id: string, changes: ServiceCaseChanges) {
  const { data } = await api.patch<ServiceCase>(`/service-cases/${id}`, changes);
  return data;
}

export const WARRANTY_LABELS: Record<ServiceWarranty, string> = { YES: "Em garantia", NO: "Sem garantia", UNKNOWN: "Garantia por confirmar" };
/** Opções do campo «Em garantia» nos formulários (curtas). */
export const WARRANTY_OPTIONS: Record<ServiceWarranty, string> = { YES: "Sim", NO: "Não", UNKNOWN: "Por confirmar" };

/** Tipo de tarefa das assistências. */
export const SERVICE_TYPE = "ASSISTENCIA";

/** Peças usadas (Fase 4c). */
export async function listServiceParts(serviceCaseId: string) {
  const { data } = await api.get<ServicePart[]>(`/service-cases/${serviceCaseId}/parts`);
  return data;
}

export async function createServicePart(serviceCaseId: string, input: { description: string; reference?: string; quantity?: number }) {
  const { data } = await api.post<ServicePart>(`/service-cases/${serviceCaseId}/parts`, input);
  return data;
}

export async function updateServicePart(serviceCaseId: string, partId: string, input: { description?: string; reference?: string | null; quantity?: number }) {
  const { data } = await api.patch<ServicePart>(`/service-cases/${serviceCaseId}/parts/${partId}`, input);
  return data;
}

export async function deleteServicePart(serviceCaseId: string, partId: string) {
  await api.delete(`/service-cases/${serviceCaseId}/parts/${partId}`);
}

/** Indicadores das assistências (Fase 4c): período [from, to) e, opcionalmente, uma pessoa. */
export async function getServiceIndicators(params: { from: string; to: string; assigneeId?: string }) {
  const { data } = await api.get<ServiceIndicators>("/service-cases/indicators", { params });
  return data;
}

/** Quantidade à portuguesa (1,5). */
export const formatQuantity = (q: number) => q.toLocaleString("pt-PT", { maximumFractionDigits: 2 });
