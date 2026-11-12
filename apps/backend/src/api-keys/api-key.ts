import { createHash, randomBytes } from "node:crypto";

/**
 * Chaves de API: `ocrm_` + 43 caracteres base64url (256 bits aleatórios). Funções puras.
 * Guarda-se só o SHA-256: a chave é aleatória e longa, por isso um hash rápido chega (bcrypt seria lento sem ganho).
 */
export const API_KEY_PREFIX = "ocrm_";
const KEY_FORMAT = /^ocrm_[A-Za-z0-9_-]{43}$/;
/** Quantos caracteres do início da chave se guardam em claro para a reconhecer na lista. */
export const DISPLAY_PREFIX_LENGTH = 8;

export interface GeneratedApiKey {
  /** A chave completa. Mostra-se uma única vez; nunca se guarda. */
  key: string;
  prefix: string;
  hash: string;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH), hash: hashApiKey(key) };
}

/** Só verifica o formato (para recusar lixo sem ir à base de dados). Não diz se a chave existe. */
export function looksLikeApiKey(value: string | undefined | null): value is string {
  return typeof value === "string" && KEY_FORMAT.test(value);
}

/** Extrai a chave de `Authorization: Bearer <chave>`. */
export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
