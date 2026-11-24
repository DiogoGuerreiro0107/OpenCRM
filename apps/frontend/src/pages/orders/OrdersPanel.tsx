import { useState } from "react";
import { Link } from "react-router-dom";
import { listOrders } from "@/lib/orders-api";
import { formatMoney } from "@/lib/products-api";
import { LoadMore, usePagedList } from "@/lib/pagination";
import { useCanWrite } from "@/lib/useCanWrite";
import { Button } from "@/components/ui/button";
import type { RecordPanelProps } from "@/modules/types";
import { NewOrderDialog, OrderStatusBadge } from "./OrdersListPage";

/** Cartão «Encomendas» nas fichas de empresa e contacto (contribuição do módulo, Fase 6a): as do cliente, mais recentes primeiro. */
export function OrdersPanel({ companyId, contactId }: RecordPanelProps) {
  const canCreate = useCanWrite("orders");
  const [creating, setCreating] = useState(false);
  const list = usePagedList(["orders", "list", "of", companyId ?? null, contactId ?? null], (cursor) => listOrders({ companyId, contactId: companyId ? undefined : contactId, cursor, limit: 5 }));
  return (
    <div className="space-y-2">
      {list.items.length === 0 && !list.isLoading && <p className="text-sm text-muted-foreground">Sem encomendas.</p>}
      <ul className="space-y-1">
        {list.items.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Link to={`/encomendas/${o.id}`} className="font-mono text-xs hover:underline">
              {o.code}
            </Link>
            <OrderStatusBadge status={o.status} />
            <span className="tabular-nums">{formatMoney(o.total)}</span>
            <span className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("pt-PT")}</span>
          </li>
        ))}
      </ul>
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["encomenda", "encomendas"]} />
      {canCreate && (
        <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          Nova encomenda
        </Button>
      )}
      {creating && <NewOrderDialog onClose={() => setCreating(false)} companyId={companyId} contactId={contactId} />}
    </div>
  );
}
