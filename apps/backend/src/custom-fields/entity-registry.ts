import { Role } from "@prisma/client";
import { WRITE_ACCESS } from "../auth/permissions";
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
  /** Quem pode preencher/alterar valores destes registos. */
  writeRoles: readonly Role[];
  exists: (prisma: PrismaService, id: string) => Promise<boolean>;
}

export const CUSTOM_FIELD_ENTITIES = {
  COMPANY: {
    label: "Empresas",
    module: null,
    writeRoles: WRITE_ACCESS.companies,
    exists: async (prisma, id) => (await prisma.company.count({ where: { id } })) > 0,
  },
  CONTACT: {
    label: "Contactos",
    module: null,
    writeRoles: WRITE_ACCESS.contacts,
    exists: async (prisma, id) => (await prisma.contact.count({ where: { id } })) > 0,
  },
  LEAD: {
    label: "Leads",
    module: "leads",
    writeRoles: WRITE_ACCESS.leads,
    exists: async (prisma, id) => (await prisma.lead.count({ where: { id } })) > 0,
  },
  DEAL: {
    label: "Negócios",
    module: "deals",
    writeRoles: WRITE_ACCESS.deals,
    exists: async (prisma, id) => (await prisma.deal.count({ where: { id } })) > 0,
  },
} satisfies Record<string, CustomFieldEntity>;

export type CustomFieldEntityType = keyof typeof CUSTOM_FIELD_ENTITIES;

export const CUSTOM_FIELD_ENTITY_TYPES = Object.keys(CUSTOM_FIELD_ENTITIES) as CustomFieldEntityType[];

export const isCustomFieldEntityType = (value: unknown): value is CustomFieldEntityType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CUSTOM_FIELD_ENTITIES, value);
