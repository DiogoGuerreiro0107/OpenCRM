import { Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/**
 * Paginação por CURSOR comum a todas as listagens (docs/plano-paginacao-listagens.md).
 * Cada lista ordena por uma chave única (colunas da ordenação + id); o cursor guarda os valores dessa chave na última
 * linha devolvida e a página seguinte começa logo a seguir. A página 100 custa o mesmo que a primeira.
 */
export const DEFAULT_PAGE_SIZE = 50;

/** `limit` e `cursor` das rotas paginadas (as rotas acrescentam os seus filtros). */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type KeyValue = string | number | Date;
export type KeyKind = "string" | "number" | "date";
export interface KeyField {
  field: string;
  dir: "asc" | "desc";
  kind: KeyKind;
}

export function encodeKey(values: KeyValue[]): string {
  return Buffer.from(JSON.stringify(values.map((v) => (v instanceof Date ? v.toISOString() : v)))).toString("base64url");
}

/** Valores da chave guardados no cursor, ou null se o cursor não for desta lista (trata-se como «primeira página»). */
export function decodeKey(cursor: string | undefined, key: KeyField[]): KeyValue[] | null {
  if (!cursor) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length !== key.length) return null;
  const values: KeyValue[] = [];
  for (let i = 0; i < key.length; i++) {
    const v = raw[i];
    if (key[i].kind === "date") {
      const date = typeof v === "string" ? new Date(v) : null;
      if (!date || Number.isNaN(date.getTime())) return null;
      values.push(date);
    } else if (key[i].kind === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      values.push(v);
    } else {
      if (typeof v !== "string") return null;
      values.push(v);
    }
  }
  return values;
}

/**
 * Condição «depois do cursor» para uma ordenação por várias colunas:
 * (a > a0) OR (a = a0 AND b > b0) OR (a = a0 AND b = b0 AND c > c0) — com «<» nas colunas por ordem decrescente.
 */
export function afterKey(key: KeyField[], values: KeyValue[]): Record<string, unknown> {
  const or: Record<string, unknown>[] = [];
  for (let i = 0; i < key.length; i++) {
    const clause: Record<string, unknown> = {};
    for (let j = 0; j < i; j++) clause[key[j].field] = values[j];
    clause[key[i].field] = { [key[i].dir === "asc" ? "gt" : "lt"]: values[i] };
    or.push(clause);
  }
  return { OR: or };
}

/** `orderBy` do Prisma pela mesma chave do cursor. */
export function orderByKey(key: KeyField[]): Record<string, "asc" | "desc">[] {
  return key.map((k) => ({ [k.field]: k.dir }));
}

/**
 * Lê uma página: `fetch` recebe a condição do cursor (ou nada, na primeira página) e quantas linhas pedir (limit + 1,
 * para saber se há mais).
 */
export async function readPage<T extends Record<string, unknown>>(
  key: KeyField[],
  query: PageQueryDto,
  fetch: (after: Record<string, unknown> | undefined, take: number) => Promise<T[]>,
  /** Valores da chave numa linha, quando alguma coluna da chave não vem na resposta (ex.: colunas internas). */
  keyOf: (row: T) => KeyValue[] = (row) => key.map((k) => row[k.field] as KeyValue),
): Promise<Page<T>> {
  const limit = query.limit ?? DEFAULT_PAGE_SIZE;
  const values = decodeKey(query.cursor, key);
  const rows = await fetch(values ? afterKey(key, values) : undefined, limit + 1);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeKey(keyOf(last)) : null };
}
