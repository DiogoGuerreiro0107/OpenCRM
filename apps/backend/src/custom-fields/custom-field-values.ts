import { BadRequestException } from "@nestjs/common";
import { CustomFieldType, Prisma } from "@prisma/client";

/**
 * Validação e conversão dos valores dos campos personalizados, por tipo de campo (Fase 0b). Funções puras.
 * Cada erro diz QUAL campo falhou (pelo rótulo), para a interface o poder mostrar.
 */

export interface ValueColumns {
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueBoolean: boolean | null;
  valueJson: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

export interface FieldForValidation {
  fieldLabel: string;
  fieldType: CustomFieldType;
  options: Prisma.JsonValue | null;
  isRequired: boolean;
}

const MAX_TEXT = 5000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+()\s.\-/]{1,50}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

const EMPTY: ValueColumns = { valueText: null, valueNumber: null, valueDate: null, valueBoolean: null, valueJson: Prisma.JsonNull };

const fail = (field: FieldForValidation, reason: string): never => {
  throw new BadRequestException(`«${field.fieldLabel}»: ${reason}`);
};

const optionsOf = (field: FieldForValidation): string[] =>
  Array.isArray(field.options) ? field.options.filter((o): o is string => typeof o === "string") : [];

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
}

function asText(field: FieldForValidation, value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") fail(field, "tem de ser texto");
  const text = String(value).trim();
  if (text.length > MAX_TEXT) fail(field, `tem no máximo ${MAX_TEXT} caracteres`);
  return text;
}

/**
 * Converte o valor recebido nas colunas a gravar. Lança 400 se o valor não servir para o tipo do campo, ou se o
 * campo for obrigatório e vier vazio.
 */
export function toValueColumns(field: FieldForValidation, value: unknown): ValueColumns {
  if (isEmpty(value)) {
    if (field.isRequired) fail(field, "é obrigatório");
    return EMPTY;
  }

  switch (field.fieldType) {
    case "NUMBER":
    case "CURRENCY": {
      const n = typeof value === "number" ? value : typeof value === "string" && NUMERIC.test(value.trim()) ? Number(value.trim()) : NaN;
      if (!Number.isFinite(n)) fail(field, "tem de ser um número");
      return { ...EMPTY, valueNumber: n };
    }
    case "DATE": {
      if (typeof value !== "string") return fail(field, "tem de ser uma data (AAAA-MM-DD)");
      const date = new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
      if (Number.isNaN(date.getTime())) fail(field, "tem de ser uma data válida (AAAA-MM-DD)");
      // AAAA-MM-DD com dia impossível (ex.: 2026-02-30) o Date «corrige» para outro dia: recusa-se.
      if (DATE_ONLY.test(value) && date.toISOString().slice(0, 10) !== value) fail(field, "tem de ser uma data válida (AAAA-MM-DD)");
      return { ...EMPTY, valueDate: date };
    }
    case "BOOLEAN":
      if (typeof value !== "boolean") fail(field, "tem de ser sim ou não (true/false)");
      return { ...EMPTY, valueBoolean: value as boolean };
    case "SELECT": {
      const text = asText(field, value);
      if (!optionsOf(field).includes(text)) fail(field, `«${text}» não é uma das opções`);
      return { ...EMPTY, valueText: text };
    }
    case "MULTISELECT": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return fail(field, "tem de ser uma lista de opções");
      const options = optionsOf(field);
      const invalid = value.filter((v) => !options.includes(v));
      if (invalid.length > 0) fail(field, `não são opções: ${invalid.join(", ")}`);
      if (new Set(value).size !== value.length) fail(field, "tem opções repetidas");
      return { ...EMPTY, valueJson: value as string[] };
    }
    case "EMAIL": {
      const text = asText(field, value);
      if (!EMAIL.test(text)) fail(field, "não é um email válido");
      return { ...EMPTY, valueText: text };
    }
    case "URL": {
      const text = asText(field, value);
      let ok = false;
      try {
        const url = new URL(text);
        ok = url.protocol === "http:" || url.protocol === "https:";
      } catch {
        ok = false;
      }
      if (!ok) fail(field, "tem de ser um endereço http:// ou https://");
      return { ...EMPTY, valueText: text };
    }
    case "PHONE": {
      const text = asText(field, value);
      if (!PHONE.test(text)) fail(field, "não é um telefone válido");
      return { ...EMPTY, valueText: text };
    }
    default:
      return { ...EMPTY, valueText: asText(field, value) };
  }
}

/** Lê o valor guardado na coluna certa para o tipo do campo. */
export function fromValueColumns(
  fieldType: CustomFieldType,
  row: { valueText: string | null; valueNumber: number | null; valueDate: Date | null; valueBoolean: boolean | null; valueJson: Prisma.JsonValue | null },
) {
  switch (fieldType) {
    case "NUMBER":
    case "CURRENCY":
      return row.valueNumber;
    case "DATE":
      return row.valueDate;
    case "BOOLEAN":
      return row.valueBoolean;
    case "MULTISELECT":
      return row.valueJson;
    default:
      return row.valueText;
  }
}
