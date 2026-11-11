import { createHash } from "node:crypto";
import { SetMetadata } from "@nestjs/common";

/** Funções puras e marcação da idempotência (a lógica com base de dados está em idempotency.interceptor.ts). */

export const IDEMPOTENT_KEY = "idempotent";

/** `@Idempotent()` numa rota POST: aceita `Idempotency-Key`. Com `{ required: true }` o cabeçalho é obrigatório. */
export const Idempotent = (options: { required?: boolean } = {}) => SetMetadata(IDEMPOTENT_KEY, options);

/** Um `Idempotency-Key` válido: 8 a 128 caracteres visíveis sem espaços. */
export const isValidIdempotencyKey = (value: unknown): value is string =>
  typeof value === "string" && /^[\x21-\x7E]{8,128}$/.test(value);

/** JSON com chaves ordenadas, para que `{a,b}` e `{b,a}` dêem a mesma impressão digital. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Impressão digital do pedido: dois pedidos com o mesmo método, caminho e corpo dão o mesmo valor. */
export function requestFingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(`${method.toUpperCase()}\n${path}\n${stableStringify(body ?? {})}`).digest("hex");
}

/** Um registo «em curso» há mais de isto considera-se abandonado (o backend pode ter caído a meio). */
export const IN_PROGRESS_TTL_MS = 5 * 60_000;
/** Registos concluídos guardam-se tanto tempo. */
export const RECORD_TTL_MS = 24 * 60 * 60_000;
