import type { Role } from "@opencrm/shared-types";

/**
 * Espelho de `apps/backend/src/auth/permissions.ts` (matriz de ESCRITA por papel), usado só para esconder
 * no ecrã o que o papel do utilizador não pode usar. A segurança real é a do backend: se isto ficar
 * desatualizado, o pior que acontece é um botão visível que devolve "sem permissão".
 *
 * Não pode divergir em silêncio: `apps/backend/src/auth/permissions-frontend-sync.spec.ts` compara as duas
 * matrizes e falha se forem diferentes. Ao mudar uma, muda a outra.
 */
const ADMIN: Role = "ADMINISTRADOR";
const COMERCIAL: Role = "COMERCIAL";
const TECNICO: Role = "TECNICO";
const BACKOFFICE: Role = "BACKOFFICE";
const FINANCEIRO: Role = "FINANCEIRO";

export const WRITE_ACCESS = {
  adminOnly: [ADMIN],
  companies: [ADMIN, COMERCIAL, BACKOFFICE, FINANCEIRO],
  contacts: [ADMIN, COMERCIAL, BACKOFFICE],
  leads: [ADMIN, COMERCIAL, BACKOFFICE],
  deals: [ADMIN, COMERCIAL, BACKOFFICE],
  dailyWork: [ADMIN, COMERCIAL, TECNICO, BACKOFFICE, FINANCEIRO],
  sendEmail: [ADMIN, COMERCIAL, BACKOFFICE],
  makeCall: [ADMIN, COMERCIAL, TECNICO, BACKOFFICE],
  emailTemplates: [ADMIN, BACKOFFICE],
} satisfies Record<string, Role[]>;

export type WriteArea = keyof typeof WRITE_ACCESS;

export const ADMIN_ONLY: Role[] = WRITE_ACCESS.adminOnly;
export const EMAIL_TEMPLATE_MANAGERS: Role[] = WRITE_ACCESS.emailTemplates;

export function hasRole(role: Role | undefined, allowed: Role[]) {
  return !!role && allowed.includes(role);
}

export function canWrite(role: Role | undefined, area: WriteArea) {
  return hasRole(role, WRITE_ACCESS[area]);
}
