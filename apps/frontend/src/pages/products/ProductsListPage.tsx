import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createProduct, formatMoney, listProductCategories, listProducts, type ProductFilters } from "@/lib/products-api";
import { LoadMore, useDebounced, usePagedList } from "@/lib/pagination";
import { useCanWrite } from "@/lib/useCanWrite";
import { errorMessage } from "@/lib/errors";
import { CompanyPicker } from "@/components/pickers";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ProductFields, productFormOf, productInputOf } from "./ProductForm";

/** Novo produto: o mesmo formulário da ficha; ao gravar, abre a ficha. */
function NewProductDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => productFormOf());
  const [localError, setLocalError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (input: Parameters<typeof createProduct>[0]) => createProduct(input),
    onSuccess: (p) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onClose();
      navigate(`/produtos/${p.id}`);
    },
  });
  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Novo produto</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          const parsed = productInputOf(form);
          setLocalError("error" in parsed ? parsed.error : null);
          if ("input" in parsed) save.mutate(parsed.input);
        }}
      >
        <ProductFields form={form} onChange={setForm} idPrefix="np" />
        {(localError || save.isError) && <p className="text-sm text-red-600">{localError ?? errorMessage(save.error, "Não foi possível criar o produto.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "A criar..." : "Criar produto"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Produtos (Fase 5a): lista por nome com pesquisa (referência, nome, código de barras, descrição, referência do
 * fornecedor) e filtros por categoria, estado, controla stock e fornecedor.
 */
export function ProductsListPage() {
  const navigate = useNavigate();
  const canWrite = useCanWrite("catalog");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const [filters, setFilters] = useState<ProductFilters>({ active: "true" });
  const { data: categories = [] } = useQuery({ queryKey: ["product-categories"], queryFn: listProductCategories });
  const list = usePagedList(["products", "list", term, filters], (cursor) => listProducts({ ...filters, search: term || undefined, cursor }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Produtos</h1>
        <div className="flex gap-2">
          {canWrite && (
            <Button asChild variant="outline">
              <Link to="/configuracoes/categorias-produtos">Categorias</Link>
            </Button>
          )}
          {canWrite && <Button onClick={() => setCreating(true)}>Novo produto</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Pesquisar produtos" placeholder="Referência, nome, código de barras..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select aria-label="Categoria" value={filters.categoryId ?? ""} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value || undefined })} className="w-44">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select aria-label="Estado" value={filters.active ?? "true"} onChange={(e) => setFilters({ ...filters, active: e.target.value as ProductFilters["active"] })} className="w-36">
          <option value="true">Ativos</option>
          <option value="false">Desativados</option>
          <option value="all">Todos</option>
        </Select>
        <Select aria-label="Controla stock" value={filters.tracksStock ?? ""} onChange={(e) => setFilters({ ...filters, tracksStock: (e.target.value || undefined) as ProductFilters["tracksStock"] })} className="w-44">
          <option value="">Com e sem stock</option>
          <option value="true">Controla stock</option>
          <option value="false">Sem stock (serviços)</option>
        </Select>
        <CompanyPicker aria-label="Fornecedor" suppliersOnly value={filters.supplierId ?? ""} onChange={(id) => setFilters({ ...filters, supplierId: id || undefined })} emptyLabel="Todos os fornecedores" className="w-56" />
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Referência</th>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Categoria</th>
              <th className="px-4 py-2 text-right font-medium">Sem IVA</th>
              <th className="px-4 py-2 text-right font-medium">Com IVA</th>
              <th className="px-4 py-2 font-medium">Fornecedor</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">A carregar...</td>
              </tr>
            )}
            {!list.isLoading && list.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nenhum produto.</td>
              </tr>
            )}
            {list.items.map((p) => (
              <tr key={p.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30" onClick={() => navigate(`/produtos/${p.id}`)}>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-2 font-medium">
                  {p.name}
                  {!p.active && <Badge className="ml-2">Desativado</Badge>}
                  {!p.tracksStock && <span className="ml-2 text-xs text-muted-foreground">sem stock</span>}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{p.category?.name ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{p.salePrice === null ? "Sob consulta" : formatMoney(p.salePrice)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-muted-foreground">{formatMoney(p.salePriceWithVat)}</td>
                <td className="px-4 py-2 text-muted-foreground">{p.preferredSupplier?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["produto", "produtos"]} />

      {creating && <NewProductDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
