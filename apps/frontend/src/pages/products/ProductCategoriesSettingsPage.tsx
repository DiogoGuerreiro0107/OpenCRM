import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductCategory } from "@opencrm/shared-types";
import { createProductCategory, deleteProductCategory, listProductCategories, updateProductCategory } from "@/lib/products-api";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Uma categoria: renomear, ordem, ativar/desativar e apagar (só sem produtos). */
function CategoryRow({ category }: { category: ProductCategory }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(category.name);
  const [order, setOrder] = useState(String(category.sortOrder));
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };
  const save = useMutation({ mutationFn: (input: Parameters<typeof updateProductCategory>[1]) => updateProductCategory(category.id, input), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => deleteProductCategory(category.id), onSuccess: refresh });
  const orderValue = Number(order);
  const changed = name.trim() !== category.name || orderValue !== category.sortOrder;

  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-2">
        <Input aria-label="Nome da categoria" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="h-8" />
      </td>
      <td className="w-24 py-2 pr-2">
        <Input aria-label="Ordem" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} className="h-8 text-right" />
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">{category.productCount}</td>
      <td className="py-2 pr-2">{category.active ? <Badge className="border-green-200 bg-green-100 text-green-800">Ativa</Badge> : <Badge>Desativada</Badge>}</td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-1">
          {changed && (
            <Button size="sm" className="h-8 px-2 text-xs" disabled={save.isPending || !name.trim() || !Number.isInteger(orderValue) || orderValue < 0} onClick={() => save.mutate({ name: name.trim(), sortOrder: orderValue })}>
              Guardar
            </Button>
          )}
          <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={save.isPending} onClick={() => save.mutate({ active: !category.active })}>
            {category.active ? "Desativar" : "Ativar"}
          </Button>
          {category.productCount === 0 && (
            <Button size="sm" variant="outline" className="h-8 px-2 text-xs text-red-700" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Apagar
            </Button>
          )}
        </div>
        {(save.isError || remove.isError) && <p className="text-xs text-red-600">{errorMessage(save.error ?? remove.error, "Não foi possível.")}</p>}
      </td>
    </tr>
  );
}

/** Configurações > Categorias de produtos (Fase 5a, área «Catálogo de produtos»). Em uso, desativa-se em vez de apagar. */
export function ProductCategoriesSettingsPage() {
  const queryClient = useQueryClient();
  const { data: categories = [], isLoading } = useQuery({ queryKey: ["product-categories"], queryFn: listProductCategories });
  const [name, setName] = useState("");
  const add = useMutation({
    mutationFn: () => createProductCategory({ name: name.trim(), sortOrder: categories.length ? Math.max(...categories.map((c) => c.sortOrder)) + 1 : 0 }),
    onSuccess: () => {
      setName("");
      queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    },
  });

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Categorias de produtos</h1>
        <p className="text-sm text-muted-foreground">Uma categoria com produtos não se apaga: desativa-se (deixa de aparecer ao escolher, mas os produtos mantêm-na).</p>
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">A carregar...</p>
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ainda não há categorias.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-1 font-medium">Nome</th>
                <th className="pb-1 font-medium">Ordem</th>
                <th className="pb-1 text-right font-medium">Produtos</th>
                <th className="pb-1 font-medium">Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <CategoryRow key={`${c.id}-${c.name}-${c.sortOrder}`} category={c} />
              ))}
            </tbody>
          </table>
        )}
        <form
          className="mt-4 flex gap-2 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <Input aria-label="Nova categoria" placeholder="Nova categoria" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
          <Button type="submit" disabled={add.isPending || !name.trim()}>
            Adicionar
          </Button>
        </form>
        {add.isError && <p className="mt-1 text-xs text-red-600">{errorMessage(add.error, "Não foi possível criar a categoria.")}</p>}
      </div>
    </div>
  );
}
