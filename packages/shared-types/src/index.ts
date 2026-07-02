export type Role = "ADMINISTRADOR" | "COMERCIAL" | "TECNICO" | "BACKOFFICE" | "FINANCEIRO" | "LEITURA_APENAS";

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

export type CompanyStatus = "ATIVO" | "POTENCIAL" | "INATIVO" | "PERDIDO";

export type CompanySource = "SITE" | "LOJA" | "CHAMADA" | "CAMPANHA" | "IMPORTACAO" | "RECOMENDACAO" | "OUTRO";

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  status: CompanyStatus;
  source: CompanySource | null;
  ownerId: string | null;
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

export type PreferredChannel = "TELEFONE" | "EMAIL" | "WHATSAPP" | "PRESENCIAL";

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  mobilePhone: string | null;
  jobTitle: string | null;
  department: string | null;
  preferredChannel: PreferredChannel | null;
  isDecisionMaker: boolean;
  marketingConsent: boolean;
  notes: string | null;
  companyId: string | null;
  ownerId: string | null;
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
  type: BusinessArea | null;
  estimatedMargin: number | null;
  lossReason: string | null;
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

export type TaskType = "CHAMADA" | "EMAIL" | "VISITA" | "PROPOSTA" | "COBRANCA" | "ASSISTENCIA" | "OUTRO";

export type TaskPriority = "BAIXA" | "NORMAL" | "ALTA" | "URGENTE";

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
  type: TaskType | null;
  priority: TaskPriority;
  result: string | null;
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

export type BusinessArea =
  | "IMPRESSAO"
  | "SOFTWARE"
  | "INFORMATICA"
  | "PAPELARIA"
  | "POS"
  | "ASSISTENCIA"
  | "OUTRO";

export type LeadStatus = "NOVO" | "CONTACTADO" | "SEM_RESPOSTA" | "CONVERTIDO" | "PERDIDO";

export interface Lead {
  id: string;
  name: string;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  interest: BusinessArea | null;
  status: LeadStatus;
  responsavelId: string | null;
  responsavel: { id: string; name: string } | null;
  nextActionAt: string | null;
  notes: string | null;
  convertedDealId: string | null;
  convertedDeal: { id: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadConversionResult {
  lead: Lead;
  company: { id: string; name: string } | null;
  contact: { id: string; name: string };
  deal: { id: string; title: string };
}

export type CustomFieldEntityType = "COMPANY" | "CONTACT" | "LEAD" | "DEAL";

export type CustomFieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "CURRENCY"
  | "DATE"
  | "BOOLEAN"
  | "SELECT"
  | "MULTISELECT"
  | "EMAIL"
  | "PHONE"
  | "URL";

export interface CustomField {
  id: string;
  entityType: CustomFieldEntityType;
  sectionName: string | null;
  fieldName: string;
  fieldLabel: string;
  fieldType: CustomFieldType;
  options: string[] | null;
  isRequired: boolean;
  isVisible: boolean;
  isSearchable: boolean;
  isFilterable: boolean;
  isAutomationEnabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomFieldValue {
  customFieldId: string;
  value: string | number | boolean | string[] | null;
}

export interface PipelineSummaryStats {
  id: string;
  name: string;
  open: number;
  won: number;
  lost: number;
  conversionRate: number;
}

export interface DashboardSummary {
  companiesTotal: number;
  contactsTotal: number;
  leadsNew: number;
  dealsOpen: number;
  dealsWon: number;
  dealsLost: number;
  openValue: number;
  tasksToday: number;
  tasksOverdue: number;
  staleDeals: number;
  staleDealDays: number;
  pipelines: PipelineSummaryStats[];
}
