import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Peças puras dos webhooks de saída (E0d, docs/plano-e0-api-publica.md): envelope, assinatura, recuo, catálogo de
 * eventos e validação de URL. Sem base de dados nem rede, para serem fáceis de testar.
 */

// ---------- Catálogo de eventos ----------

/** Eventos que o CRM publica hoje. Cada módulo novo acrescenta os seus (dentro da v1 só se acrescenta). */
export const EVENT_CATALOG = {
  "lead.created": "Lead criado (pela interface ou pela API)",
  "deal.created": "Negócio criado",
  "deal.stage_changed": "Negócio mudou de fase",
  "deal.proposal_sent": "Negócio entrou na fase «Proposta enviada»",
  "automation.deal_moved": "Uma automação moveu um negócio",
  "automation.triggered": "Uma automação disparou um webhook (nome por omissão)",
  "webhook.test": "Evento de teste enviado a partir da página de webhooks",
} as const;

export const ALL_EVENTS = "*";
const EVENT_NAME = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

/** Um nome de evento aceitável numa subscrição: `*` ou `recurso.acao` (as automações podem ter nomes próprios). */
export const isValidEventPattern = (value: string) => value === ALL_EVENTS || EVENT_NAME.test(value);

export const subscriptionWants = (events: string[], type: string) => events.includes(ALL_EVENTS) || events.includes(type);

// ---------- Envelope ----------

export interface WebhookEnvelope {
  /** Id do EVENTO: igual em todas as subscrições e em todas as repetições (serve para deduplicar). */
  id: string;
  type: string;
  version: 1;
  occurred_at: string;
  data: unknown;
}

const camelToSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Converte as chaves para snake_case em profundidade (o contrato público é snake_case; por dentro é camelCase). */
export function toSnakeCase(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toSnakeCase);
  // Decimal do Prisma e afins: têm toJSON próprio; respeita-se.
  const withJson = value as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === "function" && Object.getPrototypeOf(value) !== Object.prototype) return withJson.toJSON();
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [camelToSnake(k), toSnakeCase(v)]));
}

export function buildEnvelope(type: string, data: unknown, now: Date = new Date()): WebhookEnvelope {
  return { id: randomUUID(), type, version: 1, occurred_at: now.toISOString(), data: toSnakeCase(data) };
}

// ---------- Segredo e assinatura ----------

export const WEBHOOK_SECRET_PREFIX = "whsec_";

export const generateWebhookSecret = () => WEBHOOK_SECRET_PREFIX + randomBytes(32).toString("base64url");

/**
 * `t=<unix>,v1=<hex>`: HMAC-SHA256 de "<t>.<corpo>". O carimbo de tempo entra na assinatura para o consumidor
 * poder recusar repetições antigas de um pedido capturado.
 */
export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  const digest = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${digest}`;
}

/** Verificação de referência (é o que um consumidor deve fazer; usada nos testes e na documentação). */
export function verifySignature(secret: string, body: string, header: string | undefined, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  const provided = Buffer.from(match[2], "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

// ---------- Repetição ----------

/** Espera antes da tentativa N+1 depois de N falhas. Esgotada a lista, a entrega fica FALHADA. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
/** Falhas seguidas até a subscrição ser desativada sozinha. */
export const CIRCUIT_BREAKER_THRESHOLD = 20;
export const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Quando voltar a tentar depois de `attempts` tentativas falhadas; null = esgotou. Variação aleatória de ±20% para
 * muitas entregas falhadas ao mesmo tempo não voltarem todas no mesmo instante.
 */
export function nextAttemptDelayMs(attempts: number, random: () => number = Math.random): number | null {
  const base = RETRY_DELAYS_MS[attempts - 1];
  if (base === undefined) return null;
  return Math.round(base * (0.8 + random() * 0.4));
}

// ---------- URL ----------

/**
 * Devolve o problema do URL, ou null se serve. Só http/https e sem credenciais embutidas. Endereços privados são
 * PERMITIDOS de propósito: o destino típico (n8n) está na rede local, e só o Administrador configura subscrições.
 */
export function webhookUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "URL inválido";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "O URL tem de começar por http:// ou https://";
  if (url.username || url.password) return "O URL não pode ter utilizador/password embutidos";
  return null;
}
