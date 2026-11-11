/**
 * Âmbitos das chaves de API: o que uma chave pode fazer. Registo único em código; cada módulo novo junta os seus.
 * A chave é criada com um subconjunto destes (um âmbito desconhecido é recusado).
 */
export const API_SCOPES = {
  "companies:read": "Ler empresas",
  "contacts:read": "Ler contactos",
  "leads:write": "Criar leads (p. ex. a partir de um formulário do site)",
} as const;

export type ApiScope = keyof typeof API_SCOPES;

export const ALL_SCOPES = Object.keys(API_SCOPES) as ApiScope[];

export const isApiScope = (value: string): value is ApiScope => value in API_SCOPES;
