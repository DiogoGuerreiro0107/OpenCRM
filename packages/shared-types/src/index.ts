export type Role = "ADMINISTRADOR" | "COMERCIAL" | "TECNICO" | "BACKOFFICE" | "FINANCEIRO" | "LEITURA_APENAS";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type TimelineEventType = "NOTE" | "CALL" | "EMAIL" | "MEETING" | "FILE" | "SYSTEM";

export type TimelineEntityType = "COMPANY" | "CONTACT" | "LEAD" | "DEAL" | "TASK";

export interface TimelineEvent {
  id: string;
  entityType: TimelineEntityType;
  entityId: string;
  type: TimelineEventType;
  title: string | null;
  description: string | null;
  metadata: unknown;
  userId: string;
  user: { id: string; name: string };
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

/** Ficha da empresa. Os contactos dela vêm à parte, paginados (GET /contacts?companyId). */
export interface CompanyDetail extends Company {
  _count: { contacts: number };
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
}

export type StageType = "OPEN" | "WON" | "LOST";

/** Categoria fixa de um passo de fluxo (Fase 0c). Nos negócios, OPEN = aberto; DONE + outcome = ganho/perdido. */
export type WorkflowStepCategory = "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";

export interface Stage {
  id: string;
  name: string;
  order: number;
  /** Visão dos negócios: OPEN/WON/LOST (calculada a partir de category + outcome). */
  type: StageType;
  category: WorkflowStepCategory;
  outcome: "WON" | "LOST" | null;
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

/** Concluída e cancelada estão fechadas; as outras estão em aberto (Fase 2a). */
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "CANCELLED";

/** Tipo de tarefa (item de trabalho), configurável pelo Administrador. O id é o código estável (ex.: "VISITA"). */
export interface WorkItemType {
  id: string;
  name: string;
  /** Nome de um ícone da lista fechada (ver WORK_ITEM_ICONS no frontend). */
  icon: string;
  /** Nome de uma cor da paleta fechada. */
  color: string;
  isSystem: boolean;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
  itemCount: number;
}

export type WorkItemTypeSummary = Pick<WorkItemType, "id" | "name" | "icon" | "color">;

export type TaskPriority = "BAIXA" | "NORMAL" | "ALTA" | "URGENTE";

export interface Reminder {
  id: string;
  remindAt: string;
  message: string | null;
  workItemId: string;
  createdAt: string;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Utilizador na página de gestão (Administrador). Nunca inclui hashes nem tokens. */
export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  typeId: string;
  type: WorkItemTypeSummary;
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

/** Lead de empresa ou de pessoa (Fase 1). */
export type LeadKind = "COMPANY" | "PERSON";

/** Modo do módulo de leads: só empresas, só pessoas, ou os dois. */
export type LeadMode = "COMPANY" | "PERSON" | "BOTH";

/**
 * Numa lead de empresa, `companyName` é a empresa e `name` o contacto principal (igual ao nome da empresa quando não
 * há contacto). Numa lead de pessoa, `name` é a pessoa e a empresa é opcional.
 */
export interface Lead {
  id: string;
  kind: LeadKind;
  name: string;
  companyName: string | null;
  taxId: string | null;
  jobTitle: string | null;
  companyId: string | null;
  company: { id: string; name: string } | null;
  contactId: string | null;
  contact: { id: string; name: string } | null;
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

/** Página de uma listagem paginada por cursor (docs/plano-paginacao-listagens.md). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type LeadPage = Page<Lead>;

/** Cabeçalho de uma coluna do quadro de negócios (coluna inteira, não só os cartões carregados). */
export interface DealStageSummary {
  stageId: string;
  count: number;
  totalValue: number;
}

export interface LeadCounts {
  total: number;
  byStatus: Partial<Record<LeadStatus, number>>;
}

/** Como cada registo da conversão foi obtido: já ligado à lead, duplicado encontrado, ou criado. */
export type ConversionOutcome = "LINKED" | "MATCHED" | "CREATED";

export interface LeadConversionResult {
  lead: Lead;
  company: { id: string; name: string } | null;
  /** `null` numa lead de empresa sem contacto principal. */
  contact: { id: string; name: string } | null;
  /** `null` sem o módulo de negócios. */
  deal: { id: string; title: string } | null;
  outcome: { company: ConversionOutcome | null; contact: ConversionOutcome | null };
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
  /** Os indicadores de um módulo desligado vêm a `null` e não se mostram. */
  leadsNew: number | null;
  dealsOpen: number | null;
  dealsWon: number | null;
  dealsLost: number | null;
  openValue: number | null;
  tasksToday: number;
  tasksOverdue: number;
  staleDeals: number | null;
  staleDealDays: number;
  pipelines: PipelineSummaryStats[];
  modules: { leads: boolean; deals: boolean };
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AutomationTriggerType = "STAGE_IDLE_TIME" | "TASK_COMPLETED" | "FIELD_CHANGED";

export type AutomationActionType = "MOVE_STAGE" | "TRIGGER_WEBHOOK";

export interface AutomationRule {
  id: string;
  name: string;
  active: boolean;
  pipelineId: string | null;
  pipeline: { id: string; name: string } | null;
  stageId: string | null;
  stage: { id: string; name: string } | null;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ZadarmaAccount {
  id: string;
  callerExtension: string | null;
  active: boolean;
  lastSyncAt: string | null;
  hasCredentials: true;
}

export type CallDirection = "INBOUND" | "OUTBOUND";

export interface CallRecord {
  id: string;
  externalId: string;
  direction: CallDirection;
  fromNumber: string;
  toNumber: string;
  duration: number;
  disposition: string | null;
  recordingUrl: string | null;
  contactId: string | null;
  companyId: string | null;
  startedAt: string;
  createdAt: string;
}

/** Evento do registo de auditoria (só Administrador). `metadata` nunca contém segredos. */
export interface AuditEvent {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
}

export interface AuditPage {
  items: AuditEvent[];
  nextCursor: string | null;
}

export type ApiKeyStatus = "active" | "expired" | "revoked";

/** Chave de API na página de gestão (Administrador). Nunca inclui a chave nem o hash. */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  rateLimitPerMinute: number;
  createdById: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: ApiKeyStatus;
}

/** Resposta de criar: a chave completa só existe aqui, uma única vez. */
export interface CreatedApiKey extends ApiKeyView {
  key: string;
}

export interface ApiScopeInfo {
  scope: string;
  description: string;
}

/** Subscrição de webhook de saída (Administrador). Nunca inclui o segredo. */
export interface WebhookSubscriptionView {
  id: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Resposta de criar ou de rodar o segredo: o segredo só existe aqui, uma única vez. */
export interface WebhookSubscriptionWithSecret extends WebhookSubscriptionView {
  secret: string;
}

export type WebhookDeliveryStatus = "PENDING" | "DELIVERED" | "FAILED";

export interface WebhookDeliveryView {
  id: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface WebhookEventInfo {
  type: string;
  description: string;
}
