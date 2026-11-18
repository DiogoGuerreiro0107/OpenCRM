import { BadRequestException } from "@nestjs/common";
import { LeadKind } from "@prisma/client";

/**
 * Modo do módulo de leads (Fase 1, docs/plano-fase-1-leads.md), guardado nas opções do módulo:
 *  - COMPANY: só leads de empresa;  PERSON: só leads de pessoa;  BOTH (predefinição): os dois tipos.
 * Controla o que se pode CRIAR e como se converte; não altera leads que já existem.
 */
export const LEAD_MODES = ["COMPANY", "PERSON", "BOTH"] as const;
export type LeadMode = (typeof LEAD_MODES)[number];
export const DEFAULT_LEAD_MODE: LeadMode = "BOTH";

export const isLeadMode = (value: unknown): value is LeadMode => typeof value === "string" && (LEAD_MODES as readonly string[]).includes(value);

/** O modo guardado, ou a predefinição se não houver (ou se o valor guardado for inválido). */
export const leadModeFrom = (options: Record<string, unknown>): LeadMode => (isLeadMode(options.mode) ? options.mode : DEFAULT_LEAD_MODE);

/**
 * Tipo de uma lead nova quando quem cria não o diz (clientes antigos, API): no modo de um só tipo, esse tipo; em
 * BOTH, empresa se houver nome de empresa (a mesma regra usada para classificar as leads que já existiam).
 */
export function defaultKind(mode: LeadMode, data: { companyName?: string | null }): LeadKind {
  if (mode === "COMPANY") return "COMPANY";
  if (mode === "PERSON") return "PERSON";
  return data.companyName && data.companyName.trim() !== "" ? "COMPANY" : "PERSON";
}

/** Recusa criar (ou mudar para) um tipo que o modo não permite. */
export function assertKindAllowed(mode: LeadMode, kind: LeadKind) {
  if (mode !== "BOTH" && mode !== kind) {
    const allowed = mode === "COMPANY" ? "empresa" : "pessoa";
    throw new BadRequestException(`O módulo de leads está configurado só para leads de ${allowed}`);
  }
}
