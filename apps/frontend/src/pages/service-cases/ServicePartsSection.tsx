import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Product, ServicePart } from "@opencrm/shared-types";
import { createServicePart, deleteServicePart, formatQuantity, listServiceParts, updateServicePart } from "@/lib/service-cases-api";
import { formatQty } from "@/lib/stock-api";
import { errorMessage } from "@/lib/errors";
import { useCanWrite } from "@/lib/useCanWrite";
import { useModuleEnabled } from "@/lib/useModules";
import { ProductPicker } from "@/components/pickers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PartForm {
  description: string;
  reference: string;
  quantity: string;
  /** Produto do catálogo (só ao adicionar, Fase 5c). */
  productId?: string;
}

const emptyForm: PartForm = { description: "", reference: "", quantity: "1" };
/** «1,5» ou «1.5» → 1.5; vazio ou inválido → NaN. */
const parseQuantity = (value: string) => Number(value.trim().replace(",", "."));

/** Linha de edição (nova peça ou peça existente). */
function PartRow({
  initial,
  saving,
  error,
  onSave,
  onCancel,
  submitLabel,
  catalog,
}: {
  initial: PartForm;
  saving: boolean;
  error: unknown;
  onSave: (form: PartForm) => void;
  onCancel?: () => void;
  submitLabel: string;
  /** Mostra o seletor «Do catálogo» (produtos ligados; só ao adicionar). `showStock`: o stock está ligado. */
  catalog?: { showStock: boolean };
}) {
  const [form, setForm] = useState(initial);
  const [product, setProduct] = useState<Product | null>(null);
  const quantity = parseQuantity(form.quantity);
  const valid = form.description.trim().length > 0 && quantity > 0;
  const pick = (id: string, item: Product | null) => {
    setProduct(item);
    // Escolher preenche a descrição e a referência (editáveis); limpar deixa o texto, já sem produto.
    setForm(item ? { ...form, productId: id, description: item.name, reference: item.sku } : { ...form, productId: undefined });
  };
  const takesStock = !!product && !!catalog?.showStock && product.tracksStock;
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(form);
      }}
    >
      {catalog && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ProductPicker aria-label="Peça do catálogo" value={form.productId ?? ""} onChange={pick} selectedLabel={product?.name} showStock={catalog.showStock} emptyLabel="Do catálogo..." className="w-72" />
          {product && (takesStock ? <span>Sai do stock (atual {formatQty(product.stockOnHand)})</span> : <span>Não mexe no stock</span>)}
        </div>
      )}
      <div className="grid grid-cols-[4.5rem_1fr_8rem_auto] gap-2">
        <Input aria-label="Quantidade" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <Input aria-label="Descrição da peça" placeholder="Descrição da peça" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Input aria-label="Referência" placeholder="Referência" maxLength={120} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        <div className="flex gap-1">
          <Button type="submit" size="sm" disabled={saving || !valid}>
            {submitLabel}
          </Button>
          {onCancel && (
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </div>
      </div>
      {!!error && <p className="text-xs text-red-600">{errorMessage(error, "Não foi possível guardar.")}</p>}
    </form>
  );
}

/**
 * Peças usadas numa assistência (Fase 4c): lista inteira (no máximo 100), adicionar numa linha, editar e retirar. Cada
 * mudança fica na timeline (servidor). Com os produtos ligados, a peça pode vir do catálogo; com o stock, gasta stock
 * (Fase 5c).
 */
export function ServicePartsSection({ serviceCaseId }: { serviceCaseId: string }) {
  const queryClient = useQueryClient();
  const canEdit = useCanWrite("dailyWork");
  const productsOn = useModuleEnabled("produtos");
  const stockOn = useModuleEnabled("stock");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addKey, setAddKey] = useState(0);
  const { data: parts = [], isLoading } = useQuery({ queryKey: ["service-cases", "parts", serviceCaseId], queryFn: () => listServiceParts(serviceCaseId) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["service-cases", "parts", serviceCaseId] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
    // As peças do catálogo mexem no stock (Fase 5c).
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["stock"] });
  };
  const toInput = (form: PartForm) => ({ description: form.description.trim(), reference: form.reference.trim(), quantity: parseQuantity(form.quantity) });
  const add = useMutation({
    mutationFn: (form: PartForm) => {
      const input = toInput(form);
      return createServicePart(serviceCaseId, { ...input, reference: input.reference || undefined, productId: form.productId });
    },
    onSuccess: () => {
      setAddKey((k) => k + 1); // linha nova vazia
      refresh();
    },
  });
  const save = useMutation({
    mutationFn: ({ id, form }: { id: string; form: PartForm }) => {
      const input = toInput(form);
      return updateServicePart(serviceCaseId, id, { ...input, reference: input.reference || null });
    },
    onSuccess: () => {
      setEditingId(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteServicePart(serviceCaseId, id),
    onSuccess: () => {
      setRemovingId(null);
      refresh();
    },
  });

  const formOf = (p: ServicePart): PartForm => ({ description: p.description, reference: p.reference ?? "", quantity: formatQuantity(p.quantity) });

  return (
    <div className="space-y-3">
      {!isLoading && parts.length === 0 && <p className="text-sm text-muted-foreground">Sem peças registadas.</p>}
      <ul className="divide-y divide-border text-sm">
        {parts.map((p) =>
          editingId === p.id ? (
            <li key={p.id} className="py-2">
              <PartRow initial={formOf(p)} saving={save.isPending} error={save.error} submitLabel="Guardar" onSave={(form) => save.mutate({ id: p.id, form })} onCancel={() => setEditingId(null)} />
            </li>
          ) : (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-14 shrink-0 text-right font-mono">{formatQuantity(p.quantity)} ×</span>
              <span className="min-w-0 flex-1">
                {p.description}
                {p.product && productsOn ? (
                  <Link to={`/produtos/${p.product.id}`} className="ml-2 font-mono text-xs text-muted-foreground hover:underline" title="Abrir o produto">
                    {p.reference ?? p.product.sku}
                  </Link>
                ) : (
                  p.reference && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.reference}</span>
                )}
                {p.stockTaken > 0 && <span className="ml-2 text-xs text-muted-foreground">· saiu do stock: {formatQty(p.stockTaken)}</span>}
              </span>
              {canEdit &&
                (removingId === p.id ? (
                  <span className="flex items-center gap-1 text-xs">
                    Retirar?
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-red-700" disabled={remove.isPending} onClick={() => remove.mutate(p.id)}>
                      Sim
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setRemovingId(null)}>
                      Não
                    </Button>
                  </span>
                ) : (
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditingId(p.id)}>
                      Editar
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-red-700" onClick={() => setRemovingId(p.id)}>
                      Retirar
                    </Button>
                  </span>
                ))}
            </li>
          ),
        )}
      </ul>
      {remove.isError && <p className="text-xs text-red-600">{errorMessage(remove.error, "Não foi possível retirar.")}</p>}
      {canEdit && <PartRow key={addKey} initial={emptyForm} saving={add.isPending} error={add.error} submitLabel="Adicionar" onSave={(form) => add.mutate(form)} catalog={productsOn ? { showStock: stockOn } : undefined} />}
    </div>
  );
}
