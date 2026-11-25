import { Prisma } from "@prisma/client";
import { monotonicNow } from "../common/monotonic-clock";

/**
 * Reservas de stock para as encomendas (Fase 6b, docs/plano-fase-6-encomendas.md). A reserva é a quantidade reservada
 * na própria linha (`SalesOrderLine.reservedQuantity`); `Product.reserved` é a soma, por trigger.
 *
 * Bloqueios, sempre pela mesma ordem (sem impasses): encomenda → produtos (por id) → linhas. Um movimento de stock
 * bloqueia o produto e só toca nas linhas; as mudanças de estado das encomendas bloqueiam os produtos antes de
 * escreverem, por isso, com o produto bloqueado, o estado das encomendas que se lê não muda por baixo.
 */

type Tx = Prisma.TransactionClient;

/** Origem dos movimentos de stock lançados pelas encomendas. */
export const SALES_ORDER_SOURCE = "SALES_ORDER";

const round2 = (n: number) => Math.round(n * 100) / 100;
const pt = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 2 });

/** «2 × Toner (TN-2420)». */
export function reservationText(quantity: number, line: { description: string; sku: string | null }) {
  return `${pt(quantity)} × ${line.description}${line.sku ? ` (${line.sku})` : ""}`;
}

export type LockedProduct = { id: string; tracksStock: boolean; stockOnHand: number; reserved: number };

/** Bloqueia os produtos por ordem de id (sem repetidos) até ao fim da transação. */
export async function lockProducts(tx: Tx, ids: Array<string | null>) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))].sort();
  const locked = new Map<string, LockedProduct>();
  for (const id of unique) {
    const [row] = await tx.$queryRaw<Array<{ id: string; tracksStock: boolean; stockOnHand: Prisma.Decimal; reserved: Prisma.Decimal }>>`
      SELECT "id", "tracksStock", "stockOnHand", "reserved" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
    if (row) locked.set(id, { id: row.id, tracksStock: row.tracksStock, stockOnHand: Number(row.stockOnHand), reserved: Number(row.reserved) });
  }
  return locked;
}

/** Quanto falta reservar, por linha de produto que controla stock, numa encomenda confirmada. */
export async function waitingLines(tx: Tx, orderId: string) {
  return tx.$queryRaw<Array<{ id: string; productId: string; quantity: Prisma.Decimal; reservedQuantity: Prisma.Decimal; description: string; sku: string | null }>>`
    SELECT l."id", l."productId", l."quantity", l."reservedQuantity", l."description", l."sku"
    FROM "SalesOrderLine" l JOIN "Product" p ON p."id" = l."productId"
    WHERE l."orderId" = ${orderId} AND p."tracksStock" AND l."reservedQuantity" < l."quantity"
    ORDER BY l."position", l."id"`;
}

/**
 * Dá o disponível do produto (que tem de estar bloqueado nesta transação) às linhas que aguardam stock, das encomendas
 * confirmadas há mais tempo para as mais recentes. Escreve na timeline de cada encomenda servida. Devolve o que
 * reservou, por encomenda (as chaves são as encomendas servidas: depois de gravar, `OrderPreparationService` vê quais
 * ficaram completas — Fase 6c).
 */
export async function allocateWaiting(tx: Tx, productId: string, userId: string) {
  const [product] = await tx.$queryRaw<Array<{ tracksStock: boolean; stockOnHand: Prisma.Decimal; reserved: Prisma.Decimal }>>`
    SELECT "tracksStock", "stockOnHand", "reserved" FROM "Product" WHERE "id" = ${productId}`;
  const served = new Map<string, { number: number; items: string[] }>();
  if (!product?.tracksStock) return served;
  let available = round2(Number(product.stockOnHand) - Number(product.reserved));
  if (available <= 0) return served;

  const lines = await tx.$queryRaw<Array<{ id: string; orderId: string; number: number; quantity: Prisma.Decimal; reservedQuantity: Prisma.Decimal; description: string; sku: string | null }>>`
    SELECT l."id", l."orderId", o."number", l."quantity", l."reservedQuantity", l."description", l."sku"
    FROM "SalesOrderLine" l JOIN "SalesOrder" o ON o."id" = l."orderId"
    WHERE l."productId" = ${productId} AND o."status" = 'CONFIRMED' AND l."reservedQuantity" < l."quantity"
    ORDER BY o."confirmedAt" ASC, o."number" ASC, l."position" ASC, l."id" ASC
    FOR UPDATE OF l`;
  for (const line of lines) {
    if (available <= 0) break;
    const give = Math.min(round2(Number(line.quantity) - Number(line.reservedQuantity)), available);
    if (give <= 0) continue;
    await tx.salesOrderLine.update({ where: { id: line.id }, data: { reservedQuantity: { increment: give } } });
    available = round2(available - give);
    const entry = served.get(line.orderId) ?? { number: line.number, items: [] };
    entry.items.push(reservationText(give, line));
    served.set(line.orderId, entry);
  }
  for (const [orderId, entry] of served) {
    await tx.timelineEvent.create({ data: { entityType: "ORDER", entityId: orderId, type: "SYSTEM", description: `Stock reservado: ${entry.items.join("; ")}`, userId, createdAt: monotonicNow() } });
    if ((await waitingLines(tx, orderId)).length === 0) {
      await tx.timelineEvent.create({ data: { entityType: "ORDER", entityId: orderId, type: "SYSTEM", description: "Todo o stock da encomenda está reservado", userId, createdAt: monotonicNow() } });
    }
  }
  return served;
}
