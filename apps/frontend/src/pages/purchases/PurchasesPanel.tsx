import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDay, listPurchases } from "@/lib/purchases-api";
import { formatMoney } from "@/lib/products-api";
import { LoadMore, usePagedList } from "@/lib/pagination";
import { useCanWrite } from "@/lib/useCanWrite";
import { Button } from "@/components/ui/button";
import type { RecordPanelProps } from "@/modules/types";
import { NewPurchaseDialog, PurchaseStatusBadge } from "./PurchasesListPage";

/** Cartão «Compras» na ficha das empresas fornecedoras (Fase 6c): as compras a este fornecedor, mais recentes primeiro. */
export function PurchasesPanel({ companyId }: RecordPanelProps) {
  const canCreate = useCanWrite("purchases");
  const [creating, setCreating] = useState(false);
  const list = usePagedList(["purchase-orders", "list", "supplier", companyId ?? null], (cursor) => listPurchases({ supplierId: companyId, cursor, limit: 5 }));
  return (
    <div className="space-y-2">
      {list.items.length === 0 && !list.isLoading && <p className="text-sm text-muted-foreground">Sem compras.</p>}
      <ul className="space-y-1">
        {list.items.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
            <Link to={`/compras/${p.id}`} className="font-mono text-xs hover:underline">
              {p.code}
            </Link>
            <PurchaseStatusBadge purchase={p} />
            {p.total !== undefined && <span className="tabular-nums">{formatMoney(p.total)}</span>}
            <span className="text-xs text-muted-foreground">{p.expectedAt ? `prevista ${formatDay(p.expectedAt)}` : new Date(p.createdAt).toLocaleDateString("pt-PT")}</span>
          </li>
        ))}
      </ul>
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["compra", "compras"]} />
      {canCreate && companyId && (
        <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          Nova compra
        </Button>
      )}
      {creating && <NewPurchaseDialog onClose={() => setCreating(false)} supplierId={companyId} />}
    </div>
  );
}
