import { Role } from "@prisma/client";

/**
 * Matriz de permissões de ESCRITA (POST/PATCH/PUT/DELETE) por papel — fonte única de verdade.
 * A leitura é aberta a qualquer utilizador autenticado (CRM interno), exceto onde um
 * controller usar @Roles() explicitamente (ex.: regras de automação, conta Zadarma).
 *
 * `LEITURA_APENAS` não aparece em nenhuma lista: nunca escreve.
 * Documentação e justificação: docs/plano-endurecimento.md (pacote B).
 */
const ADMIN: Role = "ADMINISTRADOR";
const COMERCIAL: Role = "COMERCIAL";
const TECNICO: Role = "TECNICO";
const BACKOFFICE: Role = "BACKOFFICE";
const FINANCEIRO: Role = "FINANCEIRO";

export const WRITE_ACCESS = {
  /** Só o Administrador: estrutura de funis, definição de campos, automações, credenciais Zadarma. */
  adminOnly: [ADMIN],
  companies: [ADMIN, COMERCIAL, BACKOFFICE, FINANCEIRO],
  contacts: [ADMIN, COMERCIAL, BACKOFFICE],
  leads: [ADMIN, COMERCIAL, BACKOFFICE],
  deals: [ADMIN, COMERCIAL, BACKOFFICE],
  /** Trabalho do dia-a-dia de toda a equipa: tarefas, notas na timeline, valores de campos personalizados. */
  dailyWork: [ADMIN, COMERCIAL, TECNICO, BACKOFFICE, FINANCEIRO],
  sendEmail: [ADMIN, COMERCIAL, BACKOFFICE],
  makeCall: [ADMIN, COMERCIAL, TECNICO, BACKOFFICE],
  emailTemplates: [ADMIN, BACKOFFICE],
} satisfies Record<string, Role[]>;
