import type { Page, SalesOrder, SalesOrderStatus, SalesOrderSummary } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";

/** Encomendas de cliente (módulo encomendas, Fase 6a). Valores indicativos: a fatura sai do programa de faturação. */

export interface OrderFilters {
  search?: string;
  status?: SalesOrderStatus;
  companyId?: string;
  contactId?: string;
  assigneeId?: string;
}

export async function listOrders(filters: OrderFilters & PageParams) {
  const { data } = await api.get<Page<SalesOrderSummary>>("/orders", { params: filters });
  return data;
}

export async function getOrder(id: string) {
  const { data } = await api.get<SalesOrder>(`/orders/${id}`);
  return data;
}

export interface OrderHeaderInput {
  companyId?: string | null;
  contactId?: string | null;
  assigneeId?: string | null;
  customerReference?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
}

export async function createOrder(input: OrderHeaderInput) {
  const { data } = await api.post<SalesOrder>("/orders", input);
  return data;
}

export async function updateOrder(id: string, input: OrderHeaderInput) {
  const { data } = await api.patch<SalesOrder>(`/orders/${id}`, input);
  return data;
}

export async function deleteOrder(id: string) {
  await api.delete(`/orders/${id}`);
}

export interface OrderLineInput {
  productId?: string;
  description?: string;
  sku?: string | null;
  quantity?: number;
  unitPrice?: number;
  discountPct?: number;
  vatRate?: number;
}

export async function addOrderLine(orderId: string, input: OrderLineInput) {
  const { data } = await api.post<SalesOrder>(`/orders/${orderId}/lines`, input);
  return data;
}

export async function updateOrderLine(orderId: string, lineId: string, input: OrderLineInput) {
  const { data } = await api.patch<SalesOrder>(`/orders/${orderId}/lines/${lineId}`, input);
  return data;
}

export async function deleteOrderLine(orderId: string, lineId: string) {
  const { data } = await api.delete<SalesOrder>(`/orders/${orderId}/lines/${lineId}`);
  return data;
}

export type OrderStep = "confirm" | "ship" | "deliver";

export async function advanceOrder(id: string, step: OrderStep) {
  const { data } = await api.post<SalesOrder>(`/orders/${id}/${step}`);
  return data;
}

export async function cancelOrder(id: string, reason: string) {
  const { data } = await api.post<SalesOrder>(`/orders/${id}/cancel`, { reason });
  return data;
}

export const ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: "Rascunho",
  CONFIRMED: "Confirmada",
  SHIPPED: "Enviada",
  DELIVERED: "Entregue",
  CANCELLED: "Cancelada",
};

/** Cores dos estados (texto + fundo claro), sempre com o nome escrito ao lado. */
export const ORDER_STATUS_CLASSES: Record<SalesOrderStatus, string> = {
  DRAFT: "border-slate-200 bg-slate-100 text-slate-700",
  CONFIRMED: "border-blue-200 bg-blue-100 text-blue-800",
  SHIPPED: "border-violet-200 bg-violet-100 text-violet-800",
  DELIVERED: "border-green-200 bg-green-100 text-green-800",
  CANCELLED: "border-red-200 bg-red-100 text-red-800",
};

/** O passo seguinte de cada estado (botão principal da ficha). */
export const NEXT_STEP: Partial<Record<SalesOrderStatus, { step: OrderStep; label: string }>> = {
  DRAFT: { step: "confirm", label: "Confirmar encomenda" },
  CONFIRMED: { step: "ship", label: "Marcar como enviada" },
  SHIPPED: { step: "deliver", label: "Marcar como entregue" },
};

/** Nome do cliente: empresa, e o contacto quando há os dois. */
export const customerName = (o: { company: { name: string } | null; contact: { name: string } | null }) =>
  [o.company?.name, o.contact?.name].filter(Boolean).join(" · ") || "—";
