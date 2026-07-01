import type { ContactDetail, ContactSummary } from "@opencrm/shared-types";
import { api } from "./api";

export interface ContactInput {
  name: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  notes?: string;
  companyId?: string;
}

export async function listContacts(search?: string) {
  const { data } = await api.get<ContactSummary[]>("/contacts", { params: { search } });
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
