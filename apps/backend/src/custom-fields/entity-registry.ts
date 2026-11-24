import { WriteArea } from "../auth/permissions";
import { ModuleId } from "../modules/module-manifest";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Tipos de registo que aceitam campos personalizados (Fase 0b, docs/plano-fase-0-fundacoes.md).
 *
 * Um módulo novo (encomendas, assistências...) junta aqui uma linha e fica com campos personalizados sem mais
 * alterações: a que módulo pertence (desligado → 404), quem pode preencher os valores (a MESMA matriz que protege a
 * edição do próprio registo) e como confirmar que um registo existe.
 * Um teste estrutural (entity-registry.spec.ts) garante que cada linha está completa.
 */
export interface CustomFieldEntity {
  label: string;
  /** Módulo opcional a que pertence; `null` = núcleo (sempre ativo). */
  module: ModuleId | null;
  /** Área de permissões que decide quem pode preencher/alterar valores (a mesma da edição do registo; configurável). */
  writeArea: WriteArea;
  exists: (prisma: PrismaService, id: string) => Promise<boolean>;
  /**
   * Âmbitos dentro do tipo de registo (Fase 2b): um campo pode aplicar-se a todos ("") ou só a um âmbito (nas tarefas,
   * um tipo de tarefa). Sem isto, só "" é aceite.
   */
  scopes?: {
    label: string;
    isValid: (prisma: PrismaService, scopeId: string) => Promise<boolean>;
    /** Âmbito de um registo (o tipo da tarefa); `null` se o registo não existir. */
    of: (prisma: PrismaService, entityId: string) => Promise<string | null>;
  };
}

export const CUSTOM_FIELD_ENTITIES = {
  COMPANY: {
    label: "Empresas",
    module: null,
    writeArea: "companies",
    exists: async (prisma, id) => (await prisma.company.count({ where: { id } })) > 0,
  },
  CONTACT: {
    label: "Contactos",
    module: null,
    writeArea: "contacts",
    exists: async (prisma, id) => (await prisma.contact.count({ where: { id } })) > 0,
  },
  LEAD: {
    label: "Leads",
    module: "leads",
    writeArea: "leads",
    exists: async (prisma, id) => (await prisma.lead.count({ where: { id } })) > 0,
  },
  DEAL: {
    label: "Negócios",
    module: "deals",
    writeArea: "deals",
    exists: async (prisma, id) => (await prisma.deal.count({ where: { id } })) > 0,
  },
  /** Tarefas (itens de trabalho, Fase 2b): campos para todas, ou só para um tipo de tarefa. */
  WORK_ITEM: {
    label: "Tarefas",
    module: null,
    writeArea: "dailyWork",
    exists: async (prisma, id) => (await prisma.workItem.count({ where: { id } })) > 0,
    scopes: {
      label: "tipo de tarefa",
      isValid: async (prisma, scopeId) => (await prisma.workItemType.count({ where: { id: scopeId } })) > 0,
      of: async (prisma, entityId) => (await prisma.workItem.findUnique({ where: { id: entityId }, select: { typeId: true } }))?.typeId ?? null,
    },
  },
  /** Produtos do catálogo (Fase 5a). */
  PRODUCT: {
    label: "Produtos",
    module: "produtos",
    writeArea: "catalog",
    exists: async (prisma, id) => (await prisma.product.count({ where: { id } })) > 0,
  },
  /** Encomendas de cliente (Fase 6a). */
  ORDER: {
    label: "Encomendas",
    module: "encomendas",
    writeArea: "orders",
    exists: async (prisma, id) => (await prisma.salesOrder.count({ where: { id } })) > 0,
  },
} satisfies Record<string, CustomFieldEntity>;

export type CustomFieldEntityType = keyof typeof CUSTOM_FIELD_ENTITIES;

export const CUSTOM_FIELD_ENTITY_TYPES = Object.keys(CUSTOM_FIELD_ENTITIES) as CustomFieldEntityType[];

export const isCustomFieldEntityType = (value: unknown): value is CustomFieldEntityType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CUSTOM_FIELD_ENTITIES, value);
