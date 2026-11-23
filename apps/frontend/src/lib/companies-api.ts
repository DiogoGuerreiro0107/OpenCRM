import type { CompanyDetail, CompanySource, CompanyStatus, CompanySummary, Page } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";
import type { Clearable } from "./forms";

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
  isSupplier?: boolean;
}

export interface CompanyFilters {
  search?: string;
  status?: CompanyStatus;
  source?: CompanySource;
  ownerId?: string;
  /** Só fornecedores (Fase 5a). */
  supplier?: "true";
}

/** Uma página da lista (por nome). Os seletores pedem só a primeira, com `limit` pequeno. */
export async function listCompanies(filters: CompanyFilters & PageParams = {}) {
  const { data } = await api.get<Page<CompanySummary>>("/companies", { params: filters });
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

export async function updateCompany(id: string, input: Clearable<CompanyInput>) {
  const { data } = await api.patch<CompanyDetail>(`/companies/${id}`, input);
  return data;
}

export async function deleteCompany(id: string) {
  await api.delete(`/companies/${id}`);
}
