import type { BusinessArea, Lead, LeadStatus } from "@opencrm/shared-types";

export const STATUS_LABELS: Record<LeadStatus, string> = {
  NOVO: "Novo",
  CONTACTADO: "Contactado",
  SEM_RESPOSTA: "Sem resposta",
  CONVERTIDO: "Convertido",
  PERDIDO: "Perdido",
};

export const INTEREST_LABELS: Record<BusinessArea, string> = {
  IMPRESSAO: "Impressão",
  SOFTWARE: "Software",
  INFORMATICA: "Informática",
  PAPELARIA: "Papelaria",
  POS: "POS",
  ASSISTENCIA: "Assistência",
  OUTRO: "Outro",
};

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** Empresa de uma lead: a ligada, ou o nome escrito. */
export const leadCompanyName = (lead: Lead) => lead.company?.name ?? lead.companyName ?? null;

/**
 * Contacto principal de uma lead de empresa. Sem contacto, a lead guarda em `name` o nome da empresa (o backend usa a
 * mesma regra na conversão — apps/backend/src/leads/lead-conversion.ts).
 */
export function leadMainContact(lead: Lead): string | null {
  if (lead.contact) return lead.contact.name;
  return hasMainContactName(lead) ? lead.name : null;
}

/** Se o `name` de uma lead de empresa é uma pessoa (e não o nome da empresa repetido). */
export function hasMainContactName(lead: Pick<Lead, "name" | "companyName">) {
  const company = (lead.companyName ?? "").trim() || lead.name;
  return lead.name.trim() !== "" && !same(lead.name, company);
}

/** Título da lead na lista: a empresa (lead de empresa) ou a pessoa. */
export const leadTitle = (lead: Lead) => (lead.kind === "COMPANY" ? (leadCompanyName(lead) ?? lead.name) : lead.name);

/** A outra metade: o contacto principal (lead de empresa) ou a empresa (lead de pessoa). */
export const leadContactLabel = (lead: Lead) => (lead.kind === "COMPANY" ? leadMainContact(lead) : leadCompanyName(lead));
