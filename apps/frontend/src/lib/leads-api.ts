import type { Lead, LeadConversionResult, BusinessArea, LeadStatus } from "@opencrm/shared-types";
import { api } from "./api";

export interface LeadInput {
  name: string;
  companyName?: string;
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
  responsavelId?: string;
  search?: string;
}

export async function listLeads(filters: LeadFilters = {}) {
  const { data } = await api.get<Lead[]>("/leads", { params: filters });
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
