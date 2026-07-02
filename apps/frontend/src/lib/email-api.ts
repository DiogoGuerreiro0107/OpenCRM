import type { EmailMessage } from "@opencrm/shared-types";
import { api } from "./api";

export interface EmailFilters {
  contactId?: string;
  companyId?: string;
}

export interface SendEmailInput {
  to: string[];
  subject: string;
  text: string;
  contactId?: string;
  companyId?: string;
}

export async function listEmailMessages(filters: EmailFilters = {}) {
  const { data } = await api.get<EmailMessage[]>("/email/messages", { params: filters });
  return data;
}

export async function getEmailMessage(id: string) {
  const { data } = await api.get<EmailMessage>(`/email/messages/${id}`);
  return data;
}

export async function sendEmail(input: SendEmailInput) {
  const { data } = await api.post<EmailMessage>("/email/send", input);
  return data;
}

export async function getAttachmentDownloadUrl(attachmentId: string) {
  const { data } = await api.get<{ url: string }>(`/email/attachments/${attachmentId}/download`);
  return data.url;
}
