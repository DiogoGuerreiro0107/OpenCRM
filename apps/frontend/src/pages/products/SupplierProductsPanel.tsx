import { Link } from "react-router-dom";
import { formatMoney, listProducts } from "@/lib/products-api";
import { LoadMore, usePagedList } from "@/lib/pagination";
import type { RecordPanelProps } from "@/modules/types";

/** Cartão «Produtos fornecidos» na ficha de um fornecedor (contribuição do módulo produtos, Fase 5a). */
export function SupplierProductsPanel({ companyId }: RecordPanelProps) {
  const list = usePagedList(["products", "list", "supplier", companyId ?? null], (cursor) => listProducts({ supplierId: companyId, active: "all", cursor, limit: 10 }));
  return (
    <div className="space-y-2">
      {list.items.length === 0 && !list.isLoading && <p className="text-sm text-muted-foreground">Ainda não fornece produtos do catálogo.</p>}
      <ul className="space-y-1 text-sm">
        {list.items.map((p) => {
          const link = p.suppliers.find((s) => s.company.id === companyId);
          return (
            <li key={p.id}>
              <Link to={`/produtos/${p.id}`} className="hover:underline">
                <span className="mr-1 font-mono text-xs text-muted-foreground">{p.sku}</span>
                {p.name}
              </Link>
              <span className="block text-xs text-muted-foreground">
                {link?.supplierSku ? `Ref. ${link.supplierSku}` : "Sem referência do fornecedor"}
                {link?.costPrice !== undefined && ` · custo ${formatMoney(link.costPrice)}`}
                {link?.preferred && " · preferido"}
              </span>
            </li>
          );
        })}
      </ul>
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["produto", "produtos"]} />
    </div>
  );
}
