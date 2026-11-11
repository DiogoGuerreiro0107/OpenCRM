/**
 * Regras de segurança HTTP partilhadas pelo arranque da aplicação (main.ts) e pelos testes.
 * Mantidas como funções puras (sem Nest/Express) para serem fáceis de testar.
 */

const PRIVATE_IPV4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

/** Hosts considerados "rede local": localhost, IPs privados (RFC 1918 + loopback) e nomes *.local. */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "[::1]" || host.endsWith(".local") || PRIVATE_IPV4.test(host);
}

/**
 * Decide se uma origem (cabeçalho `Origin`) pode chamar a API.
 *  - sem `Origin` (curl, servidor-a-servidor, email-worker): permitido — CORS é uma proteção de browser;
 *  - origem listada em CORS_ORIGINS: permitida;
 *  - origem cujo host é da rede local (ver acima): permitida — mantém o acesso por IP a partir de outros
 *    computadores da rede, que é a forma de uso do OpenCRM;
 *  - qualquer outra (site público): recusada.
 */
export function isAllowedOrigin(origin: string | undefined, extraOrigins: string[] = []): boolean {
  if (!origin) return true;
  if (extraOrigins.includes(origin)) return true;
  try {
    return isLocalNetworkHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const SECRET_VARS = ["JWT_SECRET", "JWT_REFRESH_SECRET", "INTERNAL_API_KEY", "SECRETS_KEY"] as const;

/**
 * Em produção, recusa arrancar com segredos em falta ou ainda com o valor de exemplo
 * (`changeme_*` do .env.example). Devolve a lista de problemas (vazia = tudo bem).
 */
export function findInsecureSecrets(env: Record<string, string | undefined>): string[] {
  if (env.NODE_ENV !== "production") return [];
  return SECRET_VARS.filter((name) => {
    const value = env[name];
    return !value || value.startsWith("changeme");
  }).map((name) => `${name} em falta ou ainda com o valor de exemplo`);
}
