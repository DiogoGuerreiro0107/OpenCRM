import type { CompanyDetail, CompanySummary } from "@opencrm/shared-types";
import { api } from "./api";

export interface CompanyInput {
  name: string;
  taxId?: string;
  website?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export async function listCompanies(search?: string) {
  const { data } = await api.get<CompanySummary[]>("/companies", { params: { search } });
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
