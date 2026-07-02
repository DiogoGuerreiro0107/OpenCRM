export type Role = "ADMIN" | "GESTOR" | "COMERCIAL";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type ActivityType = "NOTE" | "CALL" | "EMAIL" | "MEETING" | "FILE";

export interface ActivityLog {
  id: string;
  type: ActivityType;
  content: string;
  contactId: string | null;
  companyId: string | null;
  authorId: string;
  author: { id: string; name: string };
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  taxId: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySummary extends Company {
  _count: { contacts: number };
}

export interface CompanyDetail extends Company {
  contacts: ContactSummary[];
  activities: ActivityLog[];
}

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  notes: string | null;
  companyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactSummary extends Contact {
  company?: { id: string; name: string } | null;
}

export interface ContactDetail extends Contact {
  company: { id: string; name: string } | null;
  activities: ActivityLog[];
}

export type StageType = "OPEN" | "WON" | "LOST";

export interface Stage {
  id: string;
  name: string;
  order: number;
  type: StageType;
  pipelineId: string;
}

export interface StageWithCount extends Stage {
  _count: { deals: number };
}

export interface Pipeline {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineWithStages extends Pipeline {
  stages: StageWithCount[];
}

export interface Deal {
  id: string;
  title: string;
  value: number;
  probability: number;
  order: number;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  contact: { id: string; name: string } | null;
  companyId: string | null;
  company: { id: string; name: string } | null;
  ownerId: string;
  owner: { id: string; name: string };
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE";

export interface Reminder {
  id: string;
  remindAt: string;
  message: string | null;
  taskId: string;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: string | null;
  assigneeId: string;
  assignee: { id: string; name: string };
  contactId: string | null;
  contact: { id: string; name: string } | null;
  companyId: string | null;
  company: { id: string; name: string } | null;
  dealId: string | null;
  deal: { id: string; title: string } | null;
  reminders: Reminder[];
  createdAt: string;
  updatedAt: string;
}

export type EmailDirection = "INBOUND" | "OUTBOUND";

export interface EmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  createdAt: string;
}

export interface EmailMessage {
  id: string;
  accountId: string;
  direction: EmailDirection;
  messageId: string;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  contactId: string | null;
  contact: { id: string; name: string } | null;
  companyId: string | null;
  company: { id: string; name: string } | null;
  attachments: EmailAttachment[];
  sentAt: string;
  createdAt: string;
}
