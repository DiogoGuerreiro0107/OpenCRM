import type { ContactDetail, ContactSummary, PreferredChannel } from "@opencrm/shared-types";
import { api } from "./api";

export interface ContactInput {
  name: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  jobTitle?: string;
  department?: string;
  preferredChannel?: PreferredChannel;
  isDecisionMaker?: boolean;
  marketingConsent?: boolean;
  notes?: string;
  companyId?: string;
  ownerId?: string;
}

export interface ContactFilters {
  search?: string;
  ownerId?: string;
  companyId?: string;
}

export async function listContacts(filters: ContactFilters = {}) {
  const { data } = await api.get<ContactSummary[]>("/contacts", { params: filters });
  return data;
}

export async function getContact(id: string) {
  const { data } = await api.get<ContactDetail>(`/contacts/${id}`);
  return data;
}

export async function createContact(input: ContactInput) {
  const { data } = await api.post<ContactDetail>("/contacts", input);
  return data;
}

export async function updateContact(id: string, input: Partial<ContactInput>) {
  const { data } = await api.patch<ContactDetail>(`/contacts/${id}`, input);
  return data;
}

export async function deleteContact(id: string) {
  await api.delete(`/contacts/${id}`);
}
