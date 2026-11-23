import type { Role } from "@opencrm/shared-types";

/**
 * Permissões no frontend (só conforto de UI: esconder o que vai falhar; quem decide é sempre o backend).
 *
 * Desde a Fase 0d o frontend NÃO tem cópia da matriz de papéis: as áreas em que o utilizador pode escrever vêm de
 * `GET /me/permissions` (ver useCanWrite.ts) e o Administrador pode alterá-las em Configurações > Permissões.
 * Aqui ficam só os NOMES das áreas (um teste no backend garante que coincidem com os dele) e a administração,
 * que é fixa (só o Administrador).
 */
export const WRITE_AREA_NAMES = [
  "companies",
  "contacts",
  "leads",
  "deals",
  "dailyWork",
  "sendEmail",
  "makeCall",
  "emailTemplates",
  "catalog",
] as const;

export type WriteArea = (typeof WRITE_AREA_NAMES)[number];

/** Administração (utilizadores, módulos, permissões, chaves, webhooks, auditoria...): fixa, nunca configurável. */
export const ADMIN_ONLY: Role[] = ["ADMINISTRADOR"];

export function hasRole(role: Role | undefined, allowed: Role[]) {
  return !!role && allowed.includes(role);
}
