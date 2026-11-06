import type { Role } from "@opencrm/shared-types";

export const ROLE_LABELS: Record<Role, string> = {
  ADMINISTRADOR: "Administrador",
  COMERCIAL: "Comercial",
  TECNICO: "Técnico",
  BACKOFFICE: "Backoffice",
  FINANCEIRO: "Financeiro",
  LEITURA_APENAS: "Leitura apenas",
};

export const ROLES = Object.keys(ROLE_LABELS) as Role[];
