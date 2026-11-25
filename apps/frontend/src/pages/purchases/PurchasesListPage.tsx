import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PurchaseOrderStatus } from "@opencrm/shared-types";
import { createPurchase, formatDay, listPurchases, PURCHASE_STATUS_CLASSES, PURCHASE_STATUS_LABELS, type PurchaseFilters } from "@/lib/purchases-api";
import { formatMoney } from "@/lib/products-api";
import { LoadMore, useDebounced, usePagedList } from "@/lib/pagination";
import { useCanWrite } from "@/lib/useCanWrite";
import { useModuleEnabled } from "@/lib/useModules";
import { errorMessage } from "@/lib/errors";
import { CompanyPicker } from "@/components/pickers";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** Compra nova: o fornecedor (só empresas fornecedoras), a referência dele e a data prevista; abre a ficha do rascunho. */
export function NewPurchaseDialog({ onClose, supplierId: initialSupplier }: { onClose: () => void; supplierId?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [supplierId, setSupplierId] = useState(initialSupplier ?? "");
  const [reference, setReference] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const save = useMutation({
    mutationFn: () => createPurchase({ supplierId, supplierReference: reference.trim() || undefined, expectedAt: expectedAt || undefined }),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      onClose();
      navigate(`/compras/${p.id}`);
    },
  });
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Nova compra</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (supplierId) save.mutate();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="np-supplier">Fornecedor *</Label>
          <CompanyPicker id="np-supplier" suppliersOnly value={supplierId} onChange={setSupplierId} emptyLabel="Escolher..." />
          <p className="text-xs text-muted-foreground">Só aparecem as empresas marcadas como fornecedor.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="np-ref">Referência do fornecedor</Label>
          <Input id="np-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} placeholder="N.º da proposta ou da encomenda dele" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="np-expected">Entrega prevista</Label>
          <Input id="np-expected" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} className="w-44" />
        </div>
        {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível criar a compra.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending || !supplierId}>
            {save.isPending ? "A criar..." : "Criar rascunho"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Estado da compra; uma enviada com alguma receção mostra «Recebida em parte». */
export function PurchaseStatusBadge({ purchase }: { purchase: { status: PurchaseOrderStatus; partiallyReceived: boolean } }) {
  if (purchase.status === "SENT" && purchase.partiallyReceived) return <Badge className="border-teal-200 bg-teal-100 text-teal-800">Recebida em parte</Badge>;
  return <Badge className={PURCHASE_STATUS_CLASSES[purchase.status]}>{PURCHASE_STATUS_LABELS[purchase.status]}</Badge>;
}

const STATUSES = Object.keys(PURCHASE_STATUS_LABELS) as PurchaseOrderStatus[];

/** Compras a fornecedor (Fase 6c): mais recentes primeiro; pesquisa (número, referência, fornecedor) e filtros. */
export function PurchasesListPage() {
  const navigate = useNavigate();
  const canWrite = useCanWrite("purchases");
  const ordersOn = useModuleEnabled("encomendas");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const [filters, setFilters] = useState<PurchaseFilters>({});
  const list = usePagedList(["purchase-orders", "list", term, filters], (cursor) => listPurchases({ ...filters, search: term || undefined, cursor }));
  // Os totais só vêm a quem vê os custos.
  const showTotals = list.items.some((p) => p.total !== undefined);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Compras a fornecedor</h1>
        <div className="flex gap-2">
          {ordersOn && (
            <Button variant="outline" onClick={() => navigate("/compras/sugestoes")}>
              O que comprar
            </Button>
          )}
          {canWrite && <Button onClick={() => setCreating(true)}>Nova compra</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Pesquisar compras" placeholder="Número, referência ou fornecedor..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select aria-label="Estado" value={filters.status ?? ""} onChange={(e) => setFilters({ ...filters, status: (e.target.value || undefined) as PurchaseOrderStatus | undefined })} className="w-44">
          <option value="">Todos os estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {PURCHASE_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <CompanyPicker aria-label="Fornecedor" suppliersOnly value={filters.supplierId ?? ""} onChange={(id) => setFilters({ ...filters, supplierId: id || undefined })} emptyLabel="Todos os fornecedores" className="w-56" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Número</th>
              <th className="px-4 py-2 font-medium">Fornecedor</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 text-right font-medium">Linhas</th>
              <th className="px-4 py-2 font-medium">Prevista</th>
              {showTotals && <th className="px-4 py-2 text-right font-medium">Total s/ IVA</th>}
              <th className="px-4 py-2 font-medium">Criada</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">A carregar...</td>
              </tr>
            )}
            {!list.isLoading && list.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Nenhuma compra.</td>
              </tr>
            )}
            {list.items.map((p) => (
              <tr key={p.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30" onClick={() => navigate(`/compras/${p.id}`)}>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                  <Link to={`/compras/${p.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                    {p.code}
                  </Link>
                  {p.supplierReference && <span className="ml-2 text-muted-foreground">{p.supplierReference}</span>}
                </td>
                <td className="px-4 py-2 font-medium">{p.supplier.name}</td>
                <td className="px-4 py-2">
                  <PurchaseStatusBadge purchase={p} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{p.lineCount}</td>
                <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{formatDay(p.expectedAt) ?? "—"}</td>
                {showTotals && <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatMoney(p.total)}</td>}
                <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{new Date(p.createdAt).toLocaleDateString("pt-PT")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["compra", "compras"]} />
      {creating && <NewPurchaseDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
