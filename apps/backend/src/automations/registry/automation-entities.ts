import { ModuleId } from "../../modules/module-manifest";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkflowEntityType } from "../../workflows/workflow-registry";
import { AutomationField } from "./conditions";

/**
 * Tipos de registo com automações (Fase 3a; tarefas e leads na 3b; docs/plano-fase-3-automacoes.md). Um módulo novo
 * junta aqui uma linha: o módulo de que depende, o tipo de fluxo (âmbito fluxo/passo), os campos que as condições podem
 * usar (os campos personalizados «disponíveis em automações» juntam-se sozinhos), o campo do responsável, as variáveis
 * dos modelos de texto e como carregar um registo. Um teste estrutural confere cada linha.
 */

export interface LoadedRecord {
  values: Record<string, unknown>;
  workflowId: string | null;
  stepId: string | null;
  /** Responsável (negócio: dono; tarefa: responsável; lead: responsável). */
  ownerId: string | null;
  /** Ligações que uma tarefa criada a partir deste registo herda. */
  links: { companyId?: string | null; contactId?: string | null; dealId?: string | null; leadId?: string | null };
  /** Valores das variáveis dos modelos de texto. */
  variables: Record<string, string | null>;
}

export interface AutomationEntity {
  label: string;
  module: ModuleId | null;
  /** Tipo de fluxo destes registos (o passo de uma regra tem de ser de um fluxo deste tipo); `null` = sem fluxo. */
  workflowEntity: WorkflowEntityType | null;
  /** Tipo de registo dos campos personalizados (os «disponíveis em automações» entram nas condições). */
  customFieldEntity: string;
  fields: AutomationField[];
  /** Campos cuja mudança o serviço do registo comunica (gatilho «campo alterado»). */
  changeTracked: string[];
  /** Campo do responsável (ação «atribuir»). */
  ownerField: string;
  /** Variáveis dos modelos de texto (nome → descrição). */
  variables: Record<string, string>;
  load: (prisma: PrismaService, id: string) => Promise<LoadedRecord | null>;
  setOwner: (prisma: PrismaService, id: string, userId: string) => Promise<void>;
  /** Nome de cada registo (para o histórico); os que já não existem ficam de fora. */
  labels: (prisma: PrismaService, ids: string[]) => Promise<Map<string, string>>;
}

const BUSINESS_AREAS = [
  { value: "IMPRESSAO", label: "Impressão" },
  { value: "SOFTWARE", label: "Software" },
  { value: "INFORMATICA", label: "Informática" },
  { value: "PAPELARIA", label: "Papelaria" },
  { value: "POS", label: "POS" },
  { value: "ASSISTENCIA", label: "Assistência" },
  { value: "OUTRO", label: "Outro" },
];

export const AUTOMATION_ENTITIES = {
  DEAL: {
    label: "Negócios",
    module: "deals",
    workflowEntity: "DEAL",
    customFieldEntity: "DEAL",
    fields: [
      { name: "value", label: "Valor", kind: "number" },
      { name: "probability", label: "Probabilidade", kind: "number" },
      { name: "estimatedMargin", label: "Margem estimada", kind: "number" },
      { name: "type", label: "Tipo de negócio", kind: "option", options: BUSINESS_AREAS },
      { name: "ownerId", label: "Responsável", kind: "user" },
      { name: "outcome", label: "Resultado", kind: "option", options: [{ value: "WON", label: "Ganho" }, { value: "LOST", label: "Perdido" }] },
    ],
    // Os que DealsService.update compara (o responsável muda-se pela ação «atribuir»).
    changeTracked: ["value", "probability", "type", "estimatedMargin", "ownerId"],
    ownerField: "ownerId",
    variables: { titulo: "Título do negócio", empresa: "Empresa", contacto: "Contacto" },
    load: async (prisma, id) => {
      const deal = await prisma.deal.findUnique({ where: { id }, include: { stage: true, company: { select: { name: true } }, contact: { select: { name: true } } } });
      if (!deal) return null;
      return {
        values: {
          value: deal.value, probability: deal.probability, estimatedMargin: deal.estimatedMargin, type: deal.type, ownerId: deal.ownerId,
          outcome: deal.stage.category === "DONE" ? deal.stage.outcome : null,
        },
        workflowId: deal.pipelineId,
        stepId: deal.stageId,
        ownerId: deal.ownerId,
        links: { dealId: deal.id, companyId: deal.companyId, contactId: deal.contactId },
        variables: { titulo: deal.title, empresa: deal.company?.name ?? null, contacto: deal.contact?.name ?? null },
      };
    },
    setOwner: async (prisma, id, userId) => {
      await prisma.deal.update({ where: { id }, data: { ownerId: userId } });
    },
    labels: async (prisma, ids) => new Map((await prisma.deal.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })).map((d) => [d.id, d.title])),
  },
  /** Tarefas (itens de trabalho, núcleo). */
  WORK_ITEM: {
    label: "Tarefas",
    module: null,
    workflowEntity: "WORK_ITEM",
    customFieldEntity: "WORK_ITEM",
    fields: [
      { name: "typeId", label: "Tipo de tarefa", kind: "option", optionsFrom: "workItemTypes" },
      {
        name: "status", label: "Estado", kind: "option",
        options: [{ value: "PENDING", label: "Pendente" }, { value: "IN_PROGRESS", label: "Em progresso" }, { value: "DONE", label: "Concluída" }, { value: "CANCELLED", label: "Cancelada" }],
      },
      {
        name: "priority", label: "Prioridade", kind: "option",
        options: [{ value: "BAIXA", label: "Baixa" }, { value: "NORMAL", label: "Normal" }, { value: "ALTA", label: "Alta" }, { value: "URGENTE", label: "Urgente" }],
      },
      { name: "assigneeId", label: "Responsável", kind: "user" },
      // Dados das assistências (módulo assistencias, Fase 4a): vazios nas tarefas que não são assistências.
      { name: "underWarranty", label: "Em garantia (assistências)", kind: "option", options: [{ value: "YES", label: "Sim" }, { value: "NO", label: "Não" }, { value: "UNKNOWN", label: "Não se sabe" }] },
      { name: "brand", label: "Marca (assistências)", kind: "text" },
    ],
    changeTracked: ["typeId", "status", "priority", "assigneeId", "underWarranty", "brand"],
    ownerField: "assigneeId",
    variables: { titulo: "Título da tarefa", empresa: "Empresa", contacto: "Contacto" },
    load: async (prisma, id) => {
      const task = await prisma.workItem.findUnique({
        where: { id },
        include: {
          type: { select: { workflowId: true } },
          company: { select: { name: true } },
          contact: { select: { name: true } },
          serviceCase: { select: { underWarranty: true, brand: true } },
        },
      });
      if (!task) return null;
      return {
        values: {
          typeId: task.typeId, status: task.status, priority: task.priority, assigneeId: task.assigneeId,
          underWarranty: task.serviceCase?.underWarranty ?? null, brand: task.serviceCase?.brand ?? null,
        },
        workflowId: task.type.workflowId,
        stepId: task.stepId,
        ownerId: task.assigneeId,
        links: { companyId: task.companyId, contactId: task.contactId, dealId: task.dealId, leadId: task.leadId },
        variables: { titulo: task.title, empresa: task.company?.name ?? null, contacto: task.contact?.name ?? null },
      };
    },
    setOwner: async (prisma, id, userId) => {
      await prisma.workItem.update({ where: { id }, data: { assigneeId: userId } });
    },
    labels: async (prisma, ids) => new Map((await prisma.workItem.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })).map((t) => [t.id, t.title])),
  },
  /** Leads (módulo leads): sem fluxo. */
  LEAD: {
    label: "Leads",
    module: "leads",
    workflowEntity: null,
    customFieldEntity: "LEAD",
    fields: [
      {
        name: "status", label: "Estado", kind: "option",
        options: [
          { value: "NOVO", label: "Novo" }, { value: "CONTACTADO", label: "Contactado" }, { value: "SEM_RESPOSTA", label: "Sem resposta" },
          { value: "CONVERTIDO", label: "Convertido" }, { value: "PERDIDO", label: "Perdido" },
        ],
      },
      { name: "kind", label: "Tipo de lead", kind: "option", options: [{ value: "COMPANY", label: "Empresa" }, { value: "PERSON", label: "Pessoa" }] },
      { name: "interest", label: "Interesse", kind: "option", options: BUSINESS_AREAS },
      { name: "source", label: "Origem", kind: "text" },
      { name: "responsavelId", label: "Responsável", kind: "user" },
    ],
    changeTracked: ["status", "interest", "responsavelId"],
    ownerField: "responsavelId",
    variables: { nome: "Nome", empresa: "Empresa", telefone: "Telefone", email: "Email" },
    load: async (prisma, id) => {
      const lead = await prisma.lead.findUnique({ where: { id } });
      if (!lead) return null;
      return {
        values: { status: lead.status, kind: lead.kind, interest: lead.interest, source: lead.source, responsavelId: lead.responsavelId },
        workflowId: null,
        stepId: null,
        ownerId: lead.responsavelId,
        // A tarefa de uma lead liga-se só à lead (como a tarefa de primeiro contacto sempre fez).
        links: { leadId: lead.id },
        variables: { nome: lead.name, empresa: lead.companyName, telefone: lead.phone, email: lead.email },
      };
    },
    setOwner: async (prisma, id, userId) => {
      await prisma.lead.update({ where: { id }, data: { responsavelId: userId } });
    },
    labels: async (prisma, ids) => new Map((await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((l) => [l.id, l.name])),
  },
} satisfies Record<string, AutomationEntity>;

export type AutomationEntityType = keyof typeof AUTOMATION_ENTITIES;

export const AUTOMATION_ENTITY_TYPES = Object.keys(AUTOMATION_ENTITIES) as AutomationEntityType[];

export const isAutomationEntityType = (value: unknown): value is AutomationEntityType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(AUTOMATION_ENTITIES, value);

export const automationEntity = (type: AutomationEntityType): AutomationEntity => AUTOMATION_ENTITIES[type];
