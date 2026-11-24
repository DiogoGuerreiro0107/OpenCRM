import type { Page, StockMovement, StockMovementType } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";

/** Stock (módulo stock, Fase 5b): livro de movimentos só de acrescentar. */

export type ManualMovementType = Exclude<StockMovementType, "SERVICE_PART">;

export async function listStockMovements(filters: { productId?: string; type?: StockMovementType } & PageParams) {
  const { data } = await api.get<Page<StockMovement>>("/stock/movements", { params: filters });
  return data;
}

export async function createStockMovement(input: { productId: string; type: ManualMovementType; quantity?: number; countedQuantity?: number; reason?: string; note?: string }) {
  const { data } = await api.post<{ movement: StockMovement; stockOnHand: number; belowMin: boolean }>("/stock/movements", input);
  return data;
}

export async function getStockSummary() {
  const { data } = await api.get<{ belowMin: number; negative: number }>("/stock/summary");
  return data;
}

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  INITIAL: "Stock inicial",
  PURCHASE_IN: "Entrada",
  SALE_OUT: "Saída",
  RETURN: "Devolução",
  ADJUSTMENT: "Acerto de contagem",
  SERVICE_PART: "Peça em assistência",
};

/** «1,5»; com sinal quando pedido («+2», «−3»). */
export const formatQty = (q: number, signed = false) => `${signed && q > 0 ? "+" : ""}${q.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}`;
