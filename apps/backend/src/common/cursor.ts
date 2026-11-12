/**
 * Cursor opaco para paginação por chave composta (data + id). Serve qualquer ordenação: quem o usa decide se
 * avança com `lt` ou `gt`. Um cursor inválido devolve null (trata-se como «primeira página»), nunca lança.
 */
export function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso);
  if (!id || Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}
