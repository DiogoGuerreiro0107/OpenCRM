import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GeneratePurchasesResult } from "@opencrm/shared-types";
import { generatePurchases, getPurchaseSuggestions } from "@/lib/purchases-api";
import { formatMoney } from "@/lib/products-api";
import { errorMessage } from "@/lib/errors";
import { useCanWrite } from "@/lib/useCanWrite";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const qty = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 2 });

/**
 * O que comprar para as encomendas à espera (Fase 6c): por produto, a aguardar + reservado acima do stock − em compra.
 * «Criar compras» junta as linhas ao rascunho de cada fornecedor (o preferido do produto, senão o único).
 */
export function PurchaseSuggestionsPage() {
  const queryClient = useQueryClient();
  const canWrite = useCanWrite("purchases");
  const seesCosts = useCanWrite("catalog");
  const { data: items = [], isLoading, isError, error } = useQuery({ queryKey: ["purchase-suggestions"], queryFn: getPurchaseSuggestions });
  /** `null` = tudo o que tem fornecedor; depois de mexer, o que ficou escolhido. */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [result, setResult] = useState<GeneratePurchasesResult | null>(null);
  const buyable = items.filter((i) => i.supplier);
  const selected = picked ? buyable.filter((i) => picked.has(i.product.id)) : buyable;
  const generate = useMutation({
    mutationFn: () => generatePurchases(selected.map((i) => i.product.id)),
    onSuccess: (r) => {
      setResult(r);
      setPicked(null);
      queryClient.invalidateQueries({ queryKey: ["purchase-suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    },
  });
  const toggle = (id: string) => {
    const next = new Set(picked ?? buyable.map((i) => i.product.id));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link to="/compras" className="text-xs text-muted-foreground hover:underline">
          ← Compras
        </Link>
        <h1 className="text-2xl font-semibold">O que comprar</h1>
        <p className="text-sm text-muted-foreground">
          Para as encomendas confirmadas que aguardam stock: a aguardar, mais o reservado acima do stock, menos o que já está em compra (rascunhos e enviadas).
        </p>
      </div>

      {result && (
        <Card>
          <CardContent className="space-y-2 pt-4 text-sm" role="status">
            {result.purchases.length > 0 ? (
              <ul className="space-y-1">
                {result.purchases.map((p) => (
                  <li key={p.id}>
                    <Link to={`/compras/${p.id}`} className="font-mono text-xs hover:underline">
                      {p.code}
                    </Link>{" "}
                    {p.supplier.name} — {p.created ? "rascunho novo" : "linhas juntas ao rascunho que já havia"}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Não foi criada nenhuma compra.</p>
            )}
            {result.skipped.length > 0 && (
              <ul className="space-y-0.5 text-muted-foreground">
                {result.skipped.map((s) => (
                  <li key={s.product.id}>
                    {s.product.name} <span className="font-mono text-xs">{s.product.sku}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Revê os rascunhos e marca-os como enviados quando fizeres o pedido ao fornecedor.</p>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              {canWrite && <th className="w-8 px-3 py-2" />}
              <th className="px-3 py-2 font-medium">Produto</th>
              <th className="px-3 py-2 text-right font-medium">A aguardar</th>
              <th className="px-3 py-2 text-right font-medium">Acima do stock</th>
              <th className="px-3 py-2 text-right font-medium">Em compra</th>
              <th className="px-3 py-2 text-right font-medium">A comprar</th>
              <th className="px-3 py-2 font-medium">Fornecedor</th>
              {seesCosts && <th className="px-3 py-2 text-right font-medium">Custo</th>}
              <th className="px-3 py-2 font-medium">Encomendas</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">A carregar...</td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-red-600">{errorMessage(error, "Não foi possível calcular as sugestões.")}</td>
              </tr>
            )}
            {!isLoading && !isError && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-muted-foreground">Nada a comprar: não há encomendas à espera de stock por cobrir.</td>
              </tr>
            )}
            {items.map((i) => (
              <tr key={i.product.id} className="border-b border-border align-top last:border-0">
                {canWrite && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Comprar ${i.product.name}`}
                      disabled={!i.supplier}
                      checked={!!i.supplier && selected.some((s) => s.product.id === i.product.id)}
                      onChange={() => toggle(i.product.id)}
                    />
                  </td>
                )}
                <td className="px-3 py-2">
                  <Link to={`/produtos/${i.product.id}`} className="font-medium hover:underline">
                    {i.product.name}
                  </Link>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{i.product.sku}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{i.waiting ? qty(i.waiting) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.overReserved ? qty(i.overReserved) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{i.onOrder ? qty(i.onOrder) : "—"}</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{qty(i.need)}</td>
                <td className="px-3 py-2">
                  {i.supplier ? (
                    i.supplier.name
                  ) : (
                    <Link to={`/produtos/${i.product.id}`} className="text-amber-800 hover:underline">
                      {i.supplierCount ? "Vários, nenhum preferido: escolhe o preferido" : "Sem fornecedor: liga um ao produto"}
                    </Link>
                  )}
                </td>
                {seesCosts && <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{i.unitCost === null || i.unitCost === undefined ? "—" : formatMoney(i.unitCost)}</td>}
                <td className="px-3 py-2">
                  <span className="flex flex-wrap gap-x-2">
                    {i.orders.map((o) => (
                      <Link key={o.id} to={`/encomendas/${o.id}`} className="font-mono text-xs hover:underline">
                        {o.code}
                      </Link>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && buyable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={generate.isPending || selected.length === 0} onClick={() => generate.mutate()}>
            {generate.isPending ? "A criar..." : `Criar compras (${selected.length} ${selected.length === 1 ? "produto" : "produtos"})`}
          </Button>
          <span className="text-xs text-muted-foreground">Uma por fornecedor; se já houver um rascunho desse fornecedor, as linhas juntam-se a ele.</span>
        </div>
      )}
      {generate.isError && <p className="text-sm text-red-600">{errorMessage(generate.error, "Não foi possível criar as compras.")}</p>}
    </div>
  );
}
