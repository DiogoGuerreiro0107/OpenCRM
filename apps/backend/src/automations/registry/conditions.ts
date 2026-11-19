/**
 * Condições das regras de automação (Fase 3a, docs/plano-fase-3-automacoes.md): `{ campo, operador, valor }`, todas têm
 * de se verificar. Funções puras: validar uma lista contra os campos de um tipo de registo e avaliá-la num registo.
 */

/** Tipos de campo que as condições conhecem. */
export type FieldKind = "number" | "text" | "option" | "user";

export interface AutomationField {
  name: string;
  label: string;
  kind: FieldKind;
  /** Opções fechadas (campos «option»). */
  options?: Array<{ value: string; label: string }>;
}

export const OPERATORS = {
  eq: "igual a",
  neq: "diferente de",
  gt: "maior que",
  gte: "maior ou igual a",
  lt: "menor que",
  lte: "menor ou igual a",
  empty: "está vazio",
  not_empty: "está preenchido",
} as const;

export type Operator = keyof typeof OPERATORS;

/** Operadores que cada tipo de campo aceita. */
export const OPERATORS_BY_KIND: Record<FieldKind, Operator[]> = {
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "not_empty"],
  text: ["eq", "neq", "empty", "not_empty"],
  option: ["eq", "neq", "empty", "not_empty"],
  user: ["eq", "neq", "empty", "not_empty"],
};

/** Operadores que não levam valor. */
const UNARY: Operator[] = ["empty", "not_empty"];

export interface Condition {
  field: string;
  operator: Operator;
  value?: string | number | null;
}

export const MAX_CONDITIONS = 10;

/**
 * Valida e normaliza uma lista de condições. Devolve a lista limpa ou lança um Error com a mensagem para o
 * administrador (quem chama transforma-o em 400).
 */
export function normalizeConditions(fields: AutomationField[], raw: unknown): Condition[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("As condições têm de ser uma lista");
  if (raw.length > MAX_CONDITIONS) throw new Error(`No máximo ${MAX_CONDITIONS} condições por regra`);
  return raw.map((item, i) => {
    const c = (item ?? {}) as Record<string, unknown>;
    const field = fields.find((f) => f.name === c.field);
    if (!field) throw new Error(`Condição ${i + 1}: campo desconhecido`);
    const operator = c.operator as Operator;
    if (!OPERATORS_BY_KIND[field.kind].includes(operator)) throw new Error(`Condição ${i + 1}: o operador não serve para «${field.label}»`);
    if (UNARY.includes(operator)) return { field: field.name, operator };
    const value = c.value;
    if (field.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Condição ${i + 1}: «${field.label}» compara com um número`);
      return { field: field.name, operator, value };
    }
    if (typeof value !== "string" || !value.trim()) throw new Error(`Condição ${i + 1}: falta o valor de «${field.label}»`);
    if (field.kind === "option" && !field.options?.some((o) => o.value === value)) throw new Error(`Condição ${i + 1}: «${value}» não é uma opção de «${field.label}»`);
    if (value.length > 200) throw new Error(`Condição ${i + 1}: valor demasiado longo`);
    return { field: field.name, operator, value };
  });
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "";

function holds(actual: unknown, c: Condition): boolean {
  switch (c.operator) {
    case "empty":
      return isEmpty(actual);
    case "not_empty":
      return !isEmpty(actual);
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
  }
  if (typeof actual !== "number" || typeof c.value !== "number") return false;
  switch (c.operator) {
    case "gt":
      return actual > c.value;
    case "gte":
      return actual >= c.value;
    case "lt":
      return actual < c.value;
    case "lte":
      return actual <= c.value;
  }
}

/** A primeira condição que falha (com o texto para o histórico), ou `null` se todas se verificam. */
export function firstFailing(fields: AutomationField[], values: Record<string, unknown>, conditions: Condition[]): string | null {
  for (const c of conditions) {
    if (!holds(values[c.field], c)) {
      const label = fields.find((f) => f.name === c.field)?.label ?? c.field;
      return `Condição não cumprida: «${label}» ${OPERATORS[c.operator]}${UNARY.includes(c.operator) ? "" : ` ${c.value}`}`;
    }
  }
  return null;
}
