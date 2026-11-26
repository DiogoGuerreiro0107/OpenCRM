/**
 * Definições das extensões (Fase E1.3, docs/plano-fase-e1-extensoes.md): descritas no manifesto, o núcleo gera o
 * formulário, valida e guarda (os segredos cifrados). Funções puras; o serviço está em extension-settings.service.ts.
 */

export type SettingType = "text" | "secret" | "select" | "boolean";

export interface SettingField {
  key: string;
  label: string;
  description?: string;
  type: SettingType;
  required?: boolean;
  /** Só em `select`. */
  options?: Array<{ value: string; label: string }>;
  /** Nunca em `secret`. */
  default?: string | boolean;
  /** Em `text` e `secret` (por omissão 500). */
  maxLength?: number;
}

export type SettingValue = string | boolean | null;

const KEY = /^[a-z][A-Za-z0-9]{0,39}$/;
const TYPES: readonly SettingType[] = ["text", "secret", "select", "boolean"];
const FIELD_KEYS = new Set(["key", "label", "description", "type", "required", "options", "default", "maxLength"]);
export const DEFAULT_MAX_LENGTH = 500;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Erros dos campos de definições de um manifesto (`at` = «id» da extensão, para as mensagens). */
export function settingFieldsErrors(at: string, value: unknown, permissions: unknown): string[] {
  if (!Array.isArray(value)) return [`${at}: settings tem de ser uma lista de campos`];
  const errors: string[] = [];
  const seen = new Set<string>();
  value.forEach((raw, i) => {
    const where = `${at}: settings[${i}]`;
    if (!isPlainObject(raw)) return errors.push(`${where} tem de ser um objeto`);
    const f = raw as Record<string, unknown>;
    for (const k of Object.keys(f)) if (!FIELD_KEYS.has(k)) errors.push(`${where}.${k} não é um campo de uma definição`);
    if (!(typeof f.key === "string" && KEY.test(f.key))) errors.push(`${where}.key tem de ser um identificador (letras e dígitos, a começar por minúscula)`);
    else if (seen.has(f.key)) errors.push(`${where}.key repete «${f.key}»`);
    else seen.add(f.key);
    if (!isText(f.label, 80)) errors.push(`${where}.label tem de ter texto (até 80 caracteres)`);
    if (f.description !== undefined && !isText(f.description, 300)) errors.push(`${where}.description tem de ter texto (até 300 caracteres)`);
    if (!TYPES.includes(f.type as SettingType)) return errors.push(`${where}.type tem de ser text, secret, select ou boolean`);
    if (f.required !== undefined && typeof f.required !== "boolean") errors.push(`${where}.required tem de ser verdadeiro ou falso`);
    if (f.maxLength !== undefined && !(Number.isInteger(f.maxLength) && (f.maxLength as number) >= 1 && (f.maxLength as number) <= 5000)) {
      errors.push(`${where}.maxLength tem de ser um inteiro de 1 a 5000`);
    }
    if (f.maxLength !== undefined && f.type !== "text" && f.type !== "secret") errors.push(`${where}.maxLength só se usa em text e secret`);
    if (f.type === "select") {
      const opts = f.options;
      if (!Array.isArray(opts) || opts.length === 0) errors.push(`${where}.options tem de ter pelo menos uma opção`);
      else {
        const values = new Set<string>();
        opts.forEach((o, j) => {
          if (!isPlainObject(o) || !(typeof o.value === "string" && o.value.length > 0 && o.value.length <= 50) || !isText(o.label, 80)) {
            errors.push(`${where}.options[${j}] tem de ter value e label`);
          } else if (values.has(o.value)) errors.push(`${where}.options repete «${o.value}»`);
          else values.add(o.value);
        });
        if (f.default !== undefined && !values.has(f.default as string)) errors.push(`${where}.default tem de ser uma das opções`);
      }
    } else if (f.options !== undefined) errors.push(`${where}.options só se usa em select`);
    if (f.type === "secret") {
      if (f.default !== undefined) errors.push(`${where}.default não se usa num segredo`);
      if (!(Array.isArray(permissions) && permissions.includes("secrets:own"))) errors.push(`${where}: um segredo exige a permissão secrets:own`);
    }
    if (f.type === "text" && f.default !== undefined && typeof f.default !== "string") errors.push(`${where}.default tem de ser texto`);
    if (f.type === "boolean" && f.default !== undefined && typeof f.default !== "boolean") errors.push(`${where}.default tem de ser verdadeiro ou falso`);
  });
  return errors;
}

/** O valor guardado (ou o por omissão) de um campo que não é segredo. */
export function effectiveValue(field: SettingField, stored: unknown): SettingValue {
  if (field.type === "boolean") return typeof stored === "boolean" ? stored : ((field.default as boolean | undefined) ?? false);
  if (field.type === "select") {
    const valid = typeof stored === "string" && field.options!.some((o) => o.value === stored);
    return valid ? (stored as string) : ((field.default as string | undefined) ?? null);
  }
  return typeof stored === "string" && stored !== "" ? stored : ((field.default as string | undefined) ?? null);
}

export interface SettingsPatchResult {
  /** O que gravar (segredos ainda em claro: o serviço cifra-os). `null` = apagar o valor. */
  changes: Record<string, SettingValue>;
  errors: string[];
}

/**
 * Valida as alterações pedidas contra os campos. `current` são os valores guardados (os segredos só interessam por
 * estarem preenchidos). Um segredo omitido fica como está; texto vazio ou null apaga (se não for obrigatório).
 */
export function validateSettingsPatch(fields: SettingField[], patch: unknown, current: Record<string, unknown>): SettingsPatchResult {
  if (!isPlainObject(patch)) return { changes: {}, errors: ["as definições têm de ser um objeto"] };
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const errors: string[] = [];
  const changes: Record<string, SettingValue> = {};
  for (const [key, value] of Object.entries(patch)) {
    const field = byKey.get(key);
    if (!field) {
      errors.push(`«${key}» não é uma definição desta extensão`);
      continue;
    }
    const empty = value === null || value === "";
    if (empty) {
      if (field.required && field.type !== "boolean") errors.push(`${field.label}: é obrigatório`);
      else changes[key] = null;
      continue;
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean") errors.push(`${field.label}: tem de ser sim ou não`);
      else changes[key] = value;
    } else if (field.type === "select") {
      if (typeof value !== "string" || !field.options!.some((o) => o.value === value)) errors.push(`${field.label}: escolhe uma das opções`);
      else changes[key] = value;
    } else {
      const max = field.maxLength ?? DEFAULT_MAX_LENGTH;
      if (typeof value !== "string") errors.push(`${field.label}: tem de ser texto`);
      else if (value.length > max) errors.push(`${field.label}: no máximo ${max} caracteres`);
      else changes[key] = field.type === "text" ? value.trim() : value;
    }
  }
  // Obrigatórios: têm de ficar preenchidos depois desta gravação.
  for (const field of fields) {
    if (!field.required || field.type === "boolean" || errors.some((e) => e.startsWith(`${field.label}:`))) continue;
    const after = Object.prototype.hasOwnProperty.call(changes, field.key) ? changes[field.key] : current[field.key];
    const filled = typeof after === "string" ? after !== "" : after !== null && after !== undefined;
    if (!filled && field.default === undefined) errors.push(`${field.label}: é obrigatório`);
  }
  return { changes, errors };
}

