import { LeadKind } from "@prisma/client";

/**
 * Regras puras da conversão de leads (Fase 1c, docs/plano-fase-1-leads.md). As mesmas normalizações existem em SQL
 * no serviço (para comparar com os registos guardados); os testes unitários fixam o comportamento das duas.
 */

/** Como cada registo da conversão foi obtido: já estava ligado, era um duplicado encontrado, ou foi criado. */
export type ConversionOutcome = "LINKED" | "MATCHED" | "CREATED";

const clean = (value: string | null | undefined) => (value ?? "").trim();

/** NIF comparável: só letras/dígitos, maiúsculas, sem o prefixo PT de um NIF português (PT123456789 = 123456789). */
export function normalizeTaxId(value: string | null | undefined): string {
  const compact = clean(value).toUpperCase().replace(/[^0-9A-Z]/g, "");
  return compact.replace(/^PT([0-9]{9})$/, "$1");
}

/** SQL equivalente a normalizeTaxId, para uma coluna. */
export const TAX_ID_SQL = (column: string) =>
  `regexp_replace(regexp_replace(upper(coalesce(${column}, '')), '[^0-9A-Z]', '', 'g'), '^PT([0-9]{9})$', '\\1')`;

/** Telefone comparável: só dígitos, sem o indicativo 351 (ou 00351) à frente de um número de 9 dígitos. */
export function normalizePhone(value: string | null | undefined): string {
  const digits = clean(value).replace(/[^0-9]/g, "");
  return digits.replace(/^(00)?351([0-9]{9})$/, "$2");
}

/** SQL equivalente a normalizePhone, para uma coluna. */
export const PHONE_SQL = (column: string) =>
  `regexp_replace(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), '^(00)?351([0-9]{9})$', '\\2')`;

/** Um telefone tão curto não identifica ninguém (evita ligar contactos por «0» ou «112»). */
export const MIN_PHONE_DIGITS = 6;

/** Nome da empresa a usar na conversão (vazio = a lead não tem empresa por nome). */
export function companyNameOf(lead: { kind: LeadKind; name: string; companyName: string | null }): string {
  const company = clean(lead.companyName);
  if (company) return company;
  // Uma lead de empresa sem nome de empresa (ex.: criada pela API no modo «só empresas») é a própria empresa.
  return lead.kind === "COMPANY" ? clean(lead.name) : "";
}

/**
 * Se a lead tem uma pessoa para virar contacto. Lead de pessoa: sempre. Lead de empresa: só se o nome (contacto
 * principal) for diferente do nome da empresa — sem contacto principal, a interface grava o nome da empresa.
 */
export function hasPerson(lead: { kind: LeadKind; name: string; companyName: string | null }): boolean {
  if (lead.kind === "PERSON") return true;
  const name = clean(lead.name).toLowerCase();
  return name !== "" && name !== companyNameOf(lead).toLowerCase();
}
