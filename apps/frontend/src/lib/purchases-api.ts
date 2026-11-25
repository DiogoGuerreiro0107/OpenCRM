import type { GeneratePurchasesResult, Page, PurchaseOrder, PurchaseOrderStatus, PurchaseOrderSummary, PurchaseSuggestion } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";

/** Compras a fornecedor (módulo compras, Fase 6c). Custos só para quem tem a área «Catálogo de produtos». */

export interface PurchaseFilters {
  search?: string;
  status?: PurchaseOrderStatus;
  supplierId?: string;
  productId?: string;
}

export async function listPurchases(filters: PurchaseFilters & PageParams) {
  const { data } = await api.get<Page<PurchaseOrderSummary>>("/purchase-orders", { params: filters });
  return data;
}

export async function getPurchase(id: string) {
  const { data } = await api.get<PurchaseOrder>(`/purchase-orders/${id}`);
  return data;
}

export interface PurchaseHeaderInput {
  supplierId?: string;
  supplierReference?: string | null;
  /** AAAA-MM-DD. */
  expectedAt?: string | null;
  notes?: string | null;
}

export async function createPurchase(input: PurchaseHeaderInput & { supplierId: string }) {
  const { data } = await api.post<PurchaseOrder>("/purchase-orders", input);
  return data;
}

export async function updatePurchase(id: string, input: PurchaseHeaderInput) {
  const { data } = await api.patch<PurchaseOrder>(`/purchase-orders/${id}`, input);
  return data;
}

export async function deletePurchase(id: string) {
  await api.delete(`/purchase-orders/${id}`);
}

export async function addPurchaseLine(id: string, input: { productId: string; quantity: number; unitCost?: number }) {
  const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/lines`, input);
  return data;
}

export async function updatePurchaseLine(id: string, lineId: string, input: { quantity?: number; unitCost?: number }) {
  const { data } = await api.patch<PurchaseOrder>(`/purchase-orders/${id}/lines/${lineId}`, input);
  return data;
}

export async function deletePurchaseLine(id: string, lineId: string) {
  const { data } = await api.delete<PurchaseOrder>(`/purchase-orders/${id}/lines/${lineId}`);
  return data;
}

export async function sendPurchase(id: string) {
  const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/send`);
  return data;
}

export async function receivePurchase(id: string, body: { lines: Array<{ lineId: string; quantity: number }>; note?: string }) {
  const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/receive`, body);
  return data;
}

export async function closePurchase(id: string, reason: string) {
  const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/close`, { reason });
  return data;
}

export async function cancelPurchase(id: string, reason: string) {
  const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason });
  return data;
}

export async function getPurchaseSuggestions() {
  const { data } = await api.get<{ items: PurchaseSuggestion[] }>("/purchase-orders/suggestions");
  return data.items;
}

export async function generatePurchases(productIds: string[]) {
  const { data } = await api.post<GeneratePurchasesResult>("/purchase-orders/generate", { productIds });
  return data;
}

export const PURCHASE_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Rascunho",
  SENT: "Enviada",
  RECEIVED: "Recebida",
  CLOSED: "Fechada com falta",
  CANCELLED: "Cancelada",
};

/** Cores dos estados (texto + fundo claro), sempre com o nome escrito ao lado. */
export const PURCHASE_STATUS_CLASSES: Record<PurchaseOrderStatus, string> = {
  DRAFT: "border-slate-200 bg-slate-100 text-slate-700",
  SENT: "border-blue-200 bg-blue-100 text-blue-800",
  RECEIVED: "border-green-200 bg-green-100 text-green-800",
  CLOSED: "border-amber-200 bg-amber-100 text-amber-900",
  CANCELLED: "border-red-200 bg-red-100 text-red-800",
};

/** «01/12/2026» a partir de AAAA-MM-DD (sem fuso: é um dia). */
export const formatDay = (day: string | null) => (day ? day.split("-").reverse().join("/") : null);
