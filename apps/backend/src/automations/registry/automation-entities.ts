import { ModuleId } from "../../modules/module-manifest";
import { PrismaService } from "../../prisma/prisma.service";
import { WorkflowEntityType } from "../../workflows/workflow-registry";
import { AutomationField } from "./conditions";

/**
 * Tipos de registo com automações (Fase 3a, docs/plano-fase-3-automacoes.md). Um módulo novo junta aqui uma linha: o
 * módulo de que depende, o tipo de fluxo (para validar o âmbito fluxo/passo), os campos que as condições podem usar e
 * como carregar um registo (valores desses campos e onde está no fluxo). Um teste estrutural confere cada linha.
 */

export interface LoadedRecord {
  values: Record<string, unknown>;
  workflowId: string | null;
  stepId: string | null;
}

export interface AutomationEntity {
  label: string;
  module: ModuleId | null;
  /** Tipo de fluxo destes registos (o passo de uma regra tem de ser de um fluxo deste tipo). */
  workflowEntity: WorkflowEntityType | null;
  fields: AutomationField[];
  /** Campos cuja mudança o serviço do registo comunica (gatilho «campo alterado»). */
  changeTracked: string[];
  load: (prisma: PrismaService, id: string) => Promise<LoadedRecord | null>;
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
    fields: [
      { name: "value", label: "Valor", kind: "number" },
      { name: "probability", label: "Probabilidade", kind: "number" },
      { name: "estimatedMargin", label: "Margem estimada", kind: "number" },
      { name: "type", label: "Tipo de negócio", kind: "option", options: BUSINESS_AREAS },
      { name: "ownerId", label: "Responsável", kind: "user" },
    ],
    // Os que DealsService.update compara (o responsável não se muda por aí).
    changeTracked: ["value", "probability", "type", "estimatedMargin"],
    load: async (prisma, id) => {
      const deal = await prisma.deal.findUnique({ where: { id } });
      if (!deal) return null;
      return {
        values: { value: deal.value, probability: deal.probability, estimatedMargin: deal.estimatedMargin, type: deal.type, ownerId: deal.ownerId },
        workflowId: deal.pipelineId,
        stepId: deal.stageId,
      };
    },
  },
} satisfies Record<string, AutomationEntity>;

export type AutomationEntityType = keyof typeof AUTOMATION_ENTITIES;

export const AUTOMATION_ENTITY_TYPES = Object.keys(AUTOMATION_ENTITIES) as AutomationEntityType[];

export const isAutomationEntityType = (value: unknown): value is AutomationEntityType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(AUTOMATION_ENTITIES, value);

export const automationEntity = (type: AutomationEntityType): AutomationEntity => AUTOMATION_ENTITIES[type];
