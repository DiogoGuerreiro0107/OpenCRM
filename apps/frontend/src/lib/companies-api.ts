import type { CompanyDetail, CompanySource, CompanyStatus, CompanySummary } from "@opencrm/shared-types";
import { api } from "./api";

export interface CompanyInput {
  name: string;
  legalName?: string;
  taxId?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  status?: CompanyStatus;
  source?: CompanySource;
  ownerId?: string;
  notes?: string;
}

export interface CompanyFilters {
  search?: string;
  status?: CompanyStatus;
  source?: CompanySource;
  ownerId?: string;
}

export async function listCompanies(filters: CompanyFilters = {}) {
  const { data } = await api.get<CompanySummary[]>("/companies", { params: filters });
  return data;
}

export async function getCompany(id: string) {
  const { data } = await api.get<CompanyDetail>(`/companies/${id}`);
  return data;
}

export async function createCompany(input: CompanyInput) {
  const { data } = await api.post<CompanyDetail>("/companies", input);
  return data;
}

export async function updateCompany(id: string, input: Partial<CompanyInput>) {
  const { data } = await api.patch<CompanyDetail>(`/companies/${id}`, input);
  return data;
}

export async function deleteCompany(id: string) {
  await api.delete(`/companies/${id}`);
}
