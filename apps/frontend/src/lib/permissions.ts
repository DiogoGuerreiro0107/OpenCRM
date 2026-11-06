import type { Role } from "@opencrm/shared-types";

/**
 * Espelho (simplificado) de `apps/backend/src/auth/permissions.ts`, usado só para esconder
 * no ecrã o que o papel do utilizador não pode usar. A segurança real é a do backend: se esta
 * lista ficar desatualizada, o pior que acontece é um botão visível que devolve "sem permissão".
 */
export const ADMIN_ONLY: Role[] = ["ADMINISTRADOR"];
export const EMAIL_TEMPLATE_MANAGERS: Role[] = ["ADMINISTRADOR", "BACKOFFICE"];

export function hasRole(role: Role | undefined, allowed: Role[]) {
  return !!role && allowed.includes(role);
}
