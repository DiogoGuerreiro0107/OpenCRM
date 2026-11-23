import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Product, ProductSupplier } from "@opencrm/shared-types";
import {
  addProductSupplier,
  decimalInput,
  deleteProduct,
  formatMoney,
  getProduct,
  parseDecimal,
  removeProductSupplier,
  UNIT_LABELS,
  updateProduct,
  updateProductSupplier,
} from "@/lib/products-api";
import { errorMessage } from "@/lib/errors";
import { useCanWrite } from "@/lib/useCanWrite";
import { CompanyPicker } from "@/components/pickers";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { ReadOnlyFieldset } from "@/components/ReadOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProductFields, productFormOf, productInputOf } from "./ProductForm";
import { ProductStockCard } from "./ProductStockCard";
import { useModuleEnabled } from "@/lib/useModules";

/** Linha de um fornecedor: referência e custo editáveis (custo só para quem o vê), preferido, retirar. */
function SupplierRow({ product, supplier, canEdit }: { product: Product; supplier: ProductSupplier; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const seesCost = supplier.costPrice !== undefined;
  const [sku, setSku] = useState(supplier.supplierSku ?? "");
  const [cost, setCost] = useState(decimalInput(supplier.costPrice));
  useEffect(() => {
    setSku(supplier.supplierSku ?? "");
    setCost(decimalInput(supplier.costPrice));
  }, [supplier.supplierSku, supplier.costPrice]);
  const refresh = (p?: Product) => {
    if (p) queryClient.setQueryData(["products", "one", product.id], p);
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };
  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateProductSupplier>[2]) => updateProductSupplier(product.id, supplier.id, input),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => removeProductSupplier(product.id, supplier.id), onSuccess: () => refresh() });
  const costValue = parseDecimal(cost);
  const changed = sku.trim() !== (supplier.supplierSku ?? "") || (seesCost && costValue !== (supplier.costPrice ?? null));
  const invalidCost = costValue !== null && (Number.isNaN(costValue) || costValue < 0);

  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-2">
        <Link to={`/empresas/${supplier.company.id}`} className="hover:underline">{supplier.company.name}</Link>
        {supplier.preferred && <Badge className="ml-2 border-primary/30 bg-primary/10 text-primary">Preferido</Badge>}
      </td>
      <td className="py-2 pr-2">
        {canEdit ? <Input aria-label="Referência do fornecedor" value={sku} maxLength={64} onChange={(e) => setSku(e.target.value)} className="h-8 font-mono text-xs" /> : <span className="font-mono text-xs">{supplier.supplierSku ?? "—"}</span>}
      </td>
      {seesCost && (
        <td className="py-2 pr-2">
          {canEdit ? <Input aria-label="Custo" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className="h-8 w-28 text-right" /> : <span className="tabular-nums">{formatMoney(supplier.costPrice, 2)}</span>}
        </td>
      )}
      {canEdit && (
        <td className="py-2 text-right">
          <div className="flex justify-end gap-1">
            {changed && (
              <Button size="sm" className="h-8 px-2 text-xs" disabled={save.isPending || invalidCost} onClick={() => save.mutate({ supplierSku: sku.trim() || null, ...(seesCost ? { costPrice: costValue } : {}) })}>
                Guardar
              </Button>
            )}
            {!supplier.preferred && (
              <Button size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={save.isPending} onClick={() => save.mutate({ preferred: true })}>
                Tornar preferido
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-8 px-2 text-xs text-red-700" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Retirar
            </Button>
          </div>
          {(save.isError || remove.isError) && <p className="text-xs text-red-600">{errorMessage(save.error ?? remove.error, "Não foi possível.")}</p>}
        </td>
      )}
    </tr>
  );
}

/** Ligar um fornecedor: qualquer empresa (fica marcada como fornecedor). */
function AddSupplier({ product, seesCost }: { product: Product; seesCost: boolean }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [sku, setSku] = useState("");
  const [cost, setCost] = useState("");
  const costValue = parseDecimal(cost);
  const add = useMutation({
    mutationFn: () => addProductSupplier(product.id, { companyId, supplierSku: sku.trim() || null, ...(seesCost ? { costPrice: costValue } : {}) }),
    onSuccess: (p) => {
      queryClient.setQueryData(["products", "one", product.id], p);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      setCompanyId("");
      setSku("");
      setCost("");
    },
  });
  return (
    <div className="space-y-1 border-t border-border pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <CompanyPicker aria-label="Fornecedor a ligar" value={companyId} onChange={setCompanyId} emptyLabel="Escolher empresa..." className="w-60" />
        <Input aria-label="Referência do fornecedor" placeholder="Referência do fornecedor" value={sku} maxLength={64} onChange={(e) => setSku(e.target.value)} className="w-48 font-mono text-xs" />
        {seesCost && <Input aria-label="Custo" placeholder="Custo" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className="w-28 text-right" />}
        <Button type="button" variant="outline" disabled={!companyId || add.isPending || (costValue !== null && (Number.isNaN(costValue) || costValue < 0))} onClick={() => add.mutate()}>
          Ligar fornecedor
        </Button>
      </div>
      {add.isError && <p className="text-xs text-red-600">{errorMessage(add.error, "Não foi possível ligar o fornecedor.")}</p>}
    </div>
  );
}

/**
 * Ficha do produto (Fase 5a): dados (preço com e sem IVA), fornecedores com a referência e o custo (só para quem pode
 * escrever no catálogo, que também vê a margem) e campos personalizados.
 */
export function ProductDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useCanWrite("catalog");
  const stockOn = useModuleEnabled("stock");
  const { data: product, isLoading, isError } = useQuery({ queryKey: ["products", "one", id], queryFn: () => getProduct(id) });
  const [form, setForm] = useState(() => productFormOf());
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // O formulário copia o produto só ao abrir (ou ao gravar): o tempo real não apaga o que se está a escrever.
  useEffect(() => {
    if (!product || product.id === loadedId) return;
    setForm(productFormOf(product));
    setLoadedId(product.id);
  }, [product, loadedId]);

  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateProduct>[1]) => updateProduct(id, input),
    onSuccess: (p) => {
      queryClient.setQueryData(["products", "one", id], p);
      queryClient.invalidateQueries({ queryKey: ["products", "list"] });
      setForm(productFormOf(p));
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      navigate("/produtos");
    },
  });

  if (isLoading) return <p className="text-muted-foreground">A carregar...</p>;
  if (isError || !product) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground">Produto não encontrado.</p>
        <Link to="/produtos" className="text-sm text-primary hover:underline">Voltar aos produtos</Link>
      </div>
    );
  }
  const seesCost = product.margin !== undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <Link to="/produtos" className="text-xs text-muted-foreground hover:underline">← Produtos</Link>
          <h1 className="text-2xl font-semibold">
            <span className="mr-2 font-mono text-base text-muted-foreground">{product.sku}</span>
            {product.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {!product.active && <Badge>Desativado</Badge>}
            <span>{product.salePrice === null ? "Sob consulta" : `${formatMoney(product.salePrice)} sem IVA · ${formatMoney(product.salePriceWithVat)} com IVA ${product.vatRate}%`}</span>
            <span>· {UNIT_LABELS[product.unit]}</span>
            {product.category && <span>· {product.category.name}</span>}
            {!product.tracksStock && <span>· sem controlo de stock</span>}
            {seesCost && product.margin !== null && product.margin !== undefined && <span>· margem {product.margin.toLocaleString("pt-PT")}%</span>}
          </div>
        </div>
        {canEdit &&
          (confirmDelete ? (
            <div className="flex items-center gap-2 text-sm">
              Apagar o produto?
              <Button variant="outline" className="text-red-700" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Apagar
              </Button>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Não
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirmDelete(true)}>
              Apagar
            </Button>
          ))}
      </div>
      {remove.isError && <p className="text-sm text-red-600">{errorMessage(remove.error, "Não foi possível apagar.")}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Dados do produto</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = productInputOf(form);
                setLocalError("error" in parsed ? parsed.error : null);
                if ("input" in parsed) save.mutate(parsed.input);
              }}
            >
              <ReadOnlyFieldset disabled={!canEdit}>
                <ProductFields form={form} onChange={setForm} />
              </ReadOnlyFieldset>
              {(localError || save.isError) && <p className="text-sm text-red-600">{localError ?? errorMessage(save.error, "Não foi possível guardar.")}</p>}
              {save.isSuccess && !save.isPending && !localError && <p className="text-sm text-green-700">Guardado.</p>}
              {canEdit && (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "A guardar..." : "Guardar"}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
        <div className="space-y-4">
          {stockOn && product.tracksStock && <ProductStockCard product={product} />}
          <Card>
            <CardHeader>
              <CardTitle>Fornecedores</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {product.suppliers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem fornecedores ligados.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-1 font-medium">Fornecedor</th>
                      <th className="pb-1 font-medium">Referência dele</th>
                      {seesCost && <th className="pb-1 font-medium">Custo</th>}
                      {canEdit && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {product.suppliers.map((s) => (
                      <SupplierRow key={s.id} product={product} supplier={s} canEdit={canEdit} />
                    ))}
                  </tbody>
                </table>
              )}
              {canEdit && <AddSupplier product={product} seesCost={seesCost} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Campos personalizados</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomFieldsSection entityType="PRODUCT" entityId={product.id} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
