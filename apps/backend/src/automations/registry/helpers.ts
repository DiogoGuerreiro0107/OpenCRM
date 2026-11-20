import { CustomFieldType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { fromValueColumns } from "../../custom-fields/custom-field-values";
import { AutomationField, FieldKind } from "./conditions";

/**
 * Auxiliares das automações (Fase 3b, docs/plano-fase-3-automacoes.md): campos personalizados nas condições, prazos e
 * modelos de texto. Funções puras ou só de leitura.
 */

// ------------------------------------------------------------------------------------------- campos personalizados

/** Tipos de campo personalizado que as condições sabem comparar (datas e seleção múltipla ficam de fora). */
const KIND_OF: Partial<Record<CustomFieldType, FieldKind>> = {
  TEXT: "text",
  TEXTAREA: "text",
  EMAIL: "text",
  PHONE: "text",
  URL: "text",
  NUMBER: "number",
  CURRENCY: "number",
  SELECT: "option",
  BOOLEAN: "option",
};

const YES_NO = [
  { value: "sim", label: "Sim" },
  { value: "não", label: "Não" },
];

/** Nome do campo nas condições: `cf:<id>` (o id não muda; o nome e o rótulo podem mudar). */
export const customFieldKey = (id: string) => `cf:${id}`;

/** Campos personalizados «disponíveis em automações» de um tipo de registo, como campos de condições. */
export async function customAutomationFields(prisma: PrismaService, entityType: string): Promise<AutomationField[]> {
  const fields = await prisma.customField.findMany({ where: { entityType, isAutomationEnabled: true }, orderBy: { sortOrder: "asc" } });
  return fields.flatMap((f) => {
    const kind = KIND_OF[f.fieldType];
    if (!kind) return [];
    const options =
      f.fieldType === "BOOLEAN"
        ? YES_NO
        : f.fieldType === "SELECT" && Array.isArray(f.options)
          ? f.options.filter((o): o is string => typeof o === "string").map((o) => ({ value: o, label: o }))
          : undefined;
    const label = f.scopeId ? `${f.fieldLabel} (${f.scopeId})` : f.fieldLabel;
    return [{ name: customFieldKey(f.id), label, kind, ...(options ? { options } : {}) }];
  });
}

/** Valores desses campos num registo (`cf:<id>` → valor; sim/não como «sim»/«não»). */
export async function customAutomationValues(prisma: PrismaService, entityType: string, entityId: string) {
  const values = await prisma.customFieldValue.findMany({
    where: { entityType, entityId, customField: { isAutomationEnabled: true } },
    include: { customField: { select: { id: true, fieldType: true } } },
  });
  const result: Record<string, unknown> = {};
  for (const v of values) {
    const value = fromValueColumns(v.customField.fieldType, v);
    result[customFieldKey(v.customField.id)] = v.customField.fieldType === "BOOLEAN" && typeof value === "boolean" ? (value ? "sim" : "não") : value;
  }
  return result;
}

// ------------------------------------------------------------------------------------------------------------- prazos

export type DueUnit = "hours" | "days" | "business_days";
export const DUE_UNITS: DueUnit[] = ["hours", "days", "business_days"];

/** Soma `amount` dias úteis (segunda a sexta; os feriados ficam para depois), mantendo a hora. */
export function addBusinessDays(from: Date, amount: number): Date {
  const date = new Date(from);
  let left = amount;
  while (left > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) left--;
  }
  return date;
}

/** Prazo relativo a `from`. */
export function dueFrom(from: Date, amount: number, unit: DueUnit): Date {
  if (unit === "hours") return new Date(from.getTime() + amount * 3_600_000);
  if (unit === "business_days") return addBusinessDays(from, amount);
  const date = new Date(from);
  date.setDate(date.getDate() + amount);
  return date;
}

// ------------------------------------------------------------------------------------------------------------- modelos

const VARIABLE = /\{([a-z_]+)\}/g;

/** Variáveis usadas num modelo (`{nome}` → «nome»). */
export const templateVariables = (template: string) => [...template.matchAll(VARIABLE)].map((m) => m[1]);

/** Substitui as variáveis; uma variável sem valor fica vazia. Espaços repetidos que sobrem juntam-se. */
export function renderTemplate(template: string, values: Record<string, string | null | undefined>) {
  return template
    .replace(VARIABLE, (_, name: string) => values[name] ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
