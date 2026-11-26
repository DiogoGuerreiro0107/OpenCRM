import { WRITE_AREAS, isWriteArea } from "../auth/permissions";

/**
 * O que uma extensão DECLARA precisar (Fase E1.1). Vocabulário fechado, para o Administrador ler sem adivinhar.
 *
 * São declaração e auditoria, NÃO uma sandbox: para código que corre dentro do backend (embutidas e forma B) nada as
 * impõe — ver docs/plano-extensoes-e-api.md §4 e §9. A página das extensões di-lo.
 */

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

const FIXED: Record<string, string> = {
  "net:egress:configured": "Liga-se aos servidores que configurares (ex.: o teu servidor de email)",
  "secrets:own": "Guarda segredos próprios (palavras-passe, chaves), cifrados",
  "webhooks:emit": "Emite eventos para os webhooks",
  "jobs:schedule": "Tem tarefas agendadas",
};

/** Descrição em português de uma permissão, ou null se não for do vocabulário. */
export function describePermission(permission: string): string | null {
  if (FIXED[permission]) return FIXED[permission];
  const data = /^data:([A-Za-z]+):write$/.exec(permission);
  if (data && isWriteArea(data[1])) return `Altera dados: ${WRITE_AREAS[data[1]].label}`;
  const net = /^net:egress:(.+)$/.exec(permission);
  if (net && DOMAIN.test(net[1])) return `Liga-se a ${net[1]}`;
  return null;
}

export const isPermission = (permission: string) => describePermission(permission) !== null;
