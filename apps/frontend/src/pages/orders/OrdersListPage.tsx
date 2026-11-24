import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SalesOrderStatus } from "@opencrm/shared-types";
import { createOrder, customerName, listOrders, ORDER_STATUS_CLASSES, ORDER_STATUS_LABELS, type OrderFilters } from "@/lib/orders-api";
import { formatMoney } from "@/lib/products-api";
import { LoadMore, useDebounced, usePagedList } from "@/lib/pagination";
import { useCanWrite } from "@/lib/useCanWrite";
import { useModuleEnabled } from "@/lib/useModules";
import { errorMessage } from "@/lib/errors";
import { CompanyPicker, ContactPicker, UserPicker } from "@/components/pickers";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/** Encomenda nova: o cliente (empresa e/ou contacto) e a referência dele; cria o rascunho e abre a ficha. */
export function NewOrderDialog({ onClose, companyId: initialCompany, contactId: initialContact }: { onClose: () => void; companyId?: string; contactId?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [companyId, setCompanyId] = useState(initialCompany ?? "");
  const [contactId, setContactId] = useState(initialContact ?? "");
  const [reference, setReference] = useState("");
  const save = useMutation({
    mutationFn: () => createOrder({ companyId: companyId || undefined, contactId: contactId || undefined, customerReference: reference.trim() || undefined }),
    onSuccess: (o) => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      onClose();
      navigate(`/encomendas/${o.id}`);
    },
  });
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Nova encomenda</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (companyId || contactId) save.mutate();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="no-company">Empresa</Label>
          <CompanyPicker
            id="no-company"
            value={companyId}
            onChange={(id) => {
              setCompanyId(id);
              setContactId("");
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="no-contact">Contacto</Label>
          <ContactPicker id="no-contact" value={contactId} onChange={setContactId} companyId={companyId || null} />
          <p className="text-xs text-muted-foreground">Indica a empresa, o contacto ou os dois.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="no-ref">Referência do cliente</Label>
          <Input id="no-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} placeholder="O número da encomenda dele, se tiver" />
        </div>
        {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível criar a encomenda.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending || (!companyId && !contactId)}>
            {save.isPending ? "A criar..." : "Criar rascunho"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function OrderStatusBadge({ status }: { status: SalesOrderStatus }) {
  return <Badge className={ORDER_STATUS_CLASSES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}

/** Confirmada com linhas à espera de stock (Fase 6b). */
export function WaitingStockBadge({ lines }: { lines: number }) {
  if (lines <= 0) return null;
  return (
    <Badge className="border-amber-200 bg-amber-100 text-amber-900" title={lines === 1 ? "1 linha aguarda stock" : `${lines} linhas aguardam stock`}>
      Aguarda stock
    </Badge>
  );
}

const STATUSES = Object.keys(ORDER_STATUS_LABELS) as SalesOrderStatus[];

/** Encomendas (Fase 6a): mais recentes primeiro; pesquisa (número, referência, cliente) e filtros por estado, cliente e responsável. */
export function OrdersListPage() {
  const navigate = useNavigate();
  const canWrite = useCanWrite("orders");
  const stockOn = useModuleEnabled("stock");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const [filters, setFilters] = useState<OrderFilters>({});
  const list = usePagedList(["orders", "list", term, filters], (cursor) => listOrders({ ...filters, search: term || undefined, cursor }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Encomendas</h1>
        {canWrite && <Button onClick={() => setCreating(true)}>Nova encomenda</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Pesquisar encomendas" placeholder="Número, referência ou cliente..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select aria-label="Estado" value={filters.status ?? ""} onChange={(e) => setFilters({ ...filters, status: (e.target.value || undefined) as SalesOrderStatus | undefined })} className="w-40">
          <option value="">Todos os estados</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <CompanyPicker aria-label="Empresa" value={filters.companyId ?? ""} onChange={(id) => setFilters({ ...filters, companyId: id || undefined })} emptyLabel="Todas as empresas" className="w-56" />
        <UserPicker aria-label="Responsável" value={filters.assigneeId ?? ""} onChange={(id) => setFilters({ ...filters, assigneeId: id || undefined })} emptyLabel="Todos os responsáveis" className="w-52" />
        {stockOn && (
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={filters.waiting === "true"} onChange={(e) => setFilters({ ...filters, waiting: e.target.checked ? "true" : undefined })} />A aguardar stock
          </label>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Número</th>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 text-right font-medium">Linhas</th>
              <th className="px-4 py-2 text-right font-medium">Total c/ IVA</th>
              <th className="px-4 py-2 font-medium">Responsável</th>
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
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Nenhuma encomenda.</td>
              </tr>
            )}
            {list.items.map((o) => (
              <tr key={o.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30" onClick={() => navigate(`/encomendas/${o.id}`)}>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                  <Link to={`/encomendas/${o.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                    {o.code}
                  </Link>
                  {o.customerReference && <span className="ml-2 text-muted-foreground">{o.customerReference}</span>}
                </td>
                <td className="px-4 py-2 font-medium">{customerName(o)}</td>
                <td className="px-4 py-2">
                  <span className="flex flex-wrap gap-1">
                    <OrderStatusBadge status={o.status} />
                    {stockOn && <WaitingStockBadge lines={o.waitingLines} />}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{o.lineCount}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatMoney(o.total)}</td>
                <td className="px-4 py-2 text-muted-foreground">{o.assignee?.name ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{new Date(o.createdAt).toLocaleDateString("pt-PT")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["encomenda", "encomendas"]} />
      {creating && <NewOrderDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
