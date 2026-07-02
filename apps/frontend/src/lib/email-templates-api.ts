import type { EmailTemplate } from "@opencrm/shared-types";
import { api } from "./api";

export interface EmailTemplateInput {
  name: string;
  subject: string;
  body: string;
  category?: string;
  active?: boolean;
}

export async function listEmailTemplates() {
  const { data } = await api.get<EmailTemplate[]>("/email-templates");
  return data;
}

export async function createEmailTemplate(input: EmailTemplateInput) {
  const { data } = await api.post<EmailTemplate>("/email-templates", input);
  return data;
}

export async function updateEmailTemplate(id: string, input: Partial<EmailTemplateInput>) {
  const { data } = await api.patch<EmailTemplate>(`/email-templates/${id}`, input);
  return data;
}

export async function deleteEmailTemplate(id: string) {
  await api.delete(`/email-templates/${id}`);
}
