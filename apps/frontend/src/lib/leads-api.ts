import type {
  Lead,
  LeadConversionResult,
  LeadCounts,
  LeadKind,
  LeadMode,
  LeadPage,
  BusinessArea,
  LeadStatus,
} from "@opencrm/shared-types";
import { api } from "./api";

export interface LeadInput {
  kind?: LeadKind;
  name: string;
  companyName?: string;
  taxId?: string;
  jobTitle?: string;
  /** `null` desliga a lead da empresa/contacto (só ao editar). */
  companyId?: string | null;
  contactId?: string | null;
  phone?: string;
  email?: string;
  source?: string;
  interest?: BusinessArea;
  status?: LeadStatus;
  responsavelId?: string;
  nextActionAt?: string;
  notes?: string;
}

export interface LeadFilters {
  status?: LeadStatus;
  kind?: LeadKind;
  responsavelId?: string;
  search?: string;
}

/** Uma página da lista (cursor da página anterior, ou nenhum para a primeira). */
export async function listLeadPage(filters: LeadFilters, cursor?: string | null) {
  const { data } = await api.get<LeadPage>("/leads/page", { params: { ...filters, cursor: cursor ?? undefined } });
  return data;
}

/** Contagens por estado (para os separadores), com os mesmos filtros exceto o estado. */
export async function getLeadCounts(filters: Omit<LeadFilters, "status">) {
  const { data } = await api.get<LeadCounts>("/leads/counts", { params: filters });
  return data;
}

export async function getLeadSettings() {
  const { data } = await api.get<{ mode: LeadMode }>("/leads/settings");
  return data;
}

export async function updateLeadSettings(mode: LeadMode) {
  const { data } = await api.patch<{ mode: LeadMode }>("/leads/settings", { mode });
  return data;
}

export async function getLead(id: string) {
  const { data } = await api.get<Lead>(`/leads/${id}`);
  return data;
}

export async function createLead(input: LeadInput) {
  const { data } = await api.post<Lead>("/leads", input);
  return data;
}

export async function updateLead(id: string, input: Partial<LeadInput>) {
  const { data } = await api.patch<Lead>(`/leads/${id}`, input);
  return data;
}

export async function deleteLead(id: string) {
  await api.delete(`/leads/${id}`);
}

export async function convertLead(id: string) {
  const { data } = await api.post<LeadConversionResult>(`/leads/${id}/convert`);
  return data;
}
