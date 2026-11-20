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
  /** Tem item próprio no menu principal (Fase 2c). */
  showInMenu: boolean;
  /** Fluxo de passos (Fase 2b); `null` = o tipo só usa o estado. */
  workflowId: string | null;
  /** Passos do fluxo, pela ordem (vazio sem fluxo). */
  steps: WorkItemStep[];
}

/** Passo de um tipo de tarefa com passos. O estado da tarefa deriva da categoria (OPEN → PENDING). */
export interface WorkItemStep {
  id: string;
  name: string;
  order: number;
  category: WorkflowStepCategory;
}

/** Fluxo lido pelas rotas genéricas (GET /workflows/:id), com quantos itens há em cada passo. */
export interface WorkflowView {
  id: string;
  entityType: string;
  name: string;
  steps: Array<WorkItemStep & { outcome: "WON" | "LOST" | null; itemCount: number }>;
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
  /** Passo (só em tipos com passos). */
  stepId: string | null;
  step: Pick<WorkItemStep, "id" | "name" | "category"> | null;
  priority: TaskPriority;
  result: string | null;
  dueDate: string | null;
  /** Horário marcado (Fase 2d), além do prazo. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
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

export type CustomFieldEntityType = "COMPANY" | "CONTACT" | "LEAD" | "DEAL" | "WORK_ITEM";

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
  /** "" = todos os registos do tipo; nas tarefas, o id de um tipo de tarefa (Fase 2b). */
  scopeId: string;
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

/** Gatilhos e ações das automações (Fase 3a): códigos dos registos do servidor (src/automations/registry/). */
export type AutomationTriggerType = "IDLE_IN_STEP" | "ALL_TASKS_CLOSED" | "FIELD_CHANGED" | "CREATED" | "ENTERED_STEP" | "CLOSED";

export type AutomationActionType = "MOVE_TO_STEP" | "WEBHOOK" | "CREATE_WORK_ITEM" | "ASSIGN";

export interface AutomationCondition {
  field: string;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "empty" | "not_empty";
  value?: string | number | null;
}

export interface AutomationRule {
  id: string;
  name: string;
  active: boolean;
  /** Regra do sistema (ex.: primeiro contacto da lead): desativa-se, mas não se apaga. */
  systemKey: string | null;
  entityType: string;
  workflowId: string | null;
  workflow: { id: string; name: string } | null;
  stepId: string | null;
  step: { id: string; name: string } | null;
  trigger: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  conditions: AutomationCondition[];
  action: AutomationActionType;
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

/**
 * Entrada das preferências do menu principal (Fase 2c), pela ordem: um item (renomeado e/ou oculto) ou um cabeçalho de
 * grupo (os itens a seguir ficam nesse grupo). Os itens em si vivem no frontend (src/modules/).
 */
export type MenuEntry =
  | { type: "item"; id: string; label?: string; hidden?: boolean }
  | { type: "group"; id: string; label: string };

export interface MenuSettings {
  entries: MenuEntry[];
  updatedAt: string | null;
}

/** Fontes da agenda (Fase 2d). Cada módulo pode acrescentar a sua (backend: src/agenda/agenda-sources.ts). */
export type AgendaSourceId = "WORK_ITEM" | "LEAD_NEXT_ACTION";

export interface AgendaEntry {
  source: AgendaSourceId;
  id: string;
  title: string;
  /** Dia (AAAA-MM-DD) no fuso do browser. */
  day: string;
  start: string;
  end: string | null;
  /** «scheduled» = horário marcado; «due» = prazo; «date» = dia inteiro. */
  kind: "scheduled" | "due" | "date";
  closed: boolean;
  cancelled: boolean;
  type: WorkItemTypeSummary | null;
  assignee: { id: string; name: string } | null;
}

export interface AgendaResponse {
  /** Fontes que entraram (as pedidas, sem as de módulos desligados). */
  sources: AgendaSourceId[];
  entries: AgendaEntry[];
  countsByDay: Record<string, number>;
}

/** Catálogo das automações (GET /automation-rules/catalog, Fase 3a/3c): o que os registos do servidor oferecem. */
export interface AutomationCatalogField {
  name: string;
  label: string;
  kind: "number" | "text" | "option" | "user";
  options?: Array<{ value: string; label: string }>;
}

export interface AutomationCatalogEntity {
  id: string;
  label: string;
  /** Tipo de fluxo (DEAL, WORK_ITEM) ou null (sem passos). */
  workflowEntity: string | null;
  fields: AutomationCatalogField[];
  /** Campos cuja mudança o gatilho «campo alterado» pode acompanhar. */
  changeTracked: string[];
  /** Variáveis dos modelos de texto (nome → descrição). */
  variables: Record<string, string>;
  triggers: Array<{ id: AutomationTriggerType; label: string; step: "required" | "optional" }>;
  actions: Array<{ id: AutomationActionType; label: string }>;
}

export interface AutomationCatalog {
  entities: AutomationCatalogEntity[];
  operators: Record<AutomationCondition["operator"], string>;
  operatorsByKind: Record<AutomationCatalogField["kind"], Array<AutomationCondition["operator"]>>;
}

/** Execução de uma regra (histórico, GET /automation-runs). */
export interface AutomationRun {
  id: string;
  ruleId: string;
  rule: { id: string; name: string };
  entityType: string;
  entityId: string;
  /** Nome do registo; null se já foi apagado. */
  entityLabel: string | null;
  trigger: string;
  outcome: "SUCCEEDED" | "SKIPPED" | "FAILED";
  message: string | null;
  depth: number;
  createdAt: string;
}

/** Garantia do equipamento de uma assistência (Fase 4a). */
export type ServiceWarranty = "YES" | "NO" | "UNKNOWN";

/** Assistência: dados próprios de uma tarefa do tipo «Assistência» (módulo assistencias, Fase 4a). */
export interface ServiceCase {
  workItemId: string;
  /** Número sequencial; `code` = AS-0001. */
  number: number;
  code: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  underWarranty: ServiceWarranty;
  reportedProblem: string;
  diagnosis: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  workItem: {
    id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    scheduledStart: string | null;
    scheduledEnd: string | null;
    typeId: string;
    stepId: string | null;
    step: { id: string; name: string; category: WorkflowStepCategory } | null;
    assignee: { id: string; name: string };
    company: { id: string; name: string } | null;
    contact: { id: string; name: string } | null;
  };
}
