import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Product, ProductUnit } from "@opencrm/shared-types";
import { decimalInput, formatMoney, listProductCategories, parseDecimal, type ProductInput, UNIT_LABELS, VAT_PRESETS } from "@/lib/products-api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export interface ProductFormState {
  sku: string;
  barcode: string;
  name: string;
  description: string;
  unit: ProductUnit;
  salePrice: string;
  vatRate: string;
  categoryId: string;
  active: boolean;
  tracksStock: boolean;
  minStock: string;
}

export function productFormOf(p?: Product | null): ProductFormState {
  return {
    sku: p?.sku ?? "",
    barcode: p?.barcode ?? "",
    name: p?.name ?? "",
    description: p?.description ?? "",
    unit: p?.unit ?? "UN",
    salePrice: decimalInput(p?.salePrice),
    vatRate: decimalInput(p?.vatRate ?? 23),
    categoryId: p?.categoryId ?? "",
    active: p?.active ?? true,
    tracksStock: p?.tracksStock ?? true,
    minStock: decimalInput(p?.minStock),
  };
}

/** Valida e converte o formulário; devolve o erro a mostrar ou os dados a enviar. */
export function productInputOf(form: ProductFormState): { error: string } | { input: ProductInput & { sku: string; name: string } } {
  const salePrice = parseDecimal(form.salePrice);
  const vatRate = parseDecimal(form.vatRate);
  const minStock = parseDecimal(form.minStock);
  if (!form.sku.trim()) return { error: "Indica a referência." };
  if (!form.name.trim()) return { error: "Indica o nome." };
  if (salePrice !== null && (Number.isNaN(salePrice) || salePrice < 0)) return { error: "O preço tem de ser um número positivo." };
  if (vatRate === null || Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) return { error: "A taxa de IVA vai de 0 a 100." };
  if (minStock !== null && (Number.isNaN(minStock) || minStock < 0)) return { error: "O stock mínimo tem de ser um número positivo." };
  return {
    input: {
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      unit: form.unit,
      salePrice,
      vatRate,
      categoryId: form.categoryId || null,
      active: form.active,
      tracksStock: form.tracksStock,
      minStock,
    },
  };
}

/**
 * Campos do produto (Fase 5a), usados ao criar e na ficha. O preço é sem IVA; mostra-se também com IVA. As categorias
 * desativadas só aparecem se forem a do produto.
 */
export function ProductFields({ form, onChange, idPrefix = "p" }: { form: ProductFormState; onChange: (form: ProductFormState) => void; idPrefix?: string }) {
  const { data: categories = [] } = useQuery({ queryKey: ["product-categories"], queryFn: listProductCategories });
  const set = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) => onChange({ ...form, [key]: value });
  const price = parseDecimal(form.salePrice);
  const vat = parseDecimal(form.vatRate);
  const withVat = price !== null && vat !== null && !Number.isNaN(price) && !Number.isNaN(vat) ? Math.round(price * (1 + vat / 100) * 100) / 100 : null;
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[2fr_3fr] gap-3">
        <div className="space-y-1">
          <Label htmlFor={id("sku")}>Referência *</Label>
          <Input id={id("sku")} value={form.sku} maxLength={64} onChange={(e) => set("sku", e.target.value)} className="font-mono uppercase" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("name")}>Nome *</Label>
          <Input id={id("name")} value={form.name} maxLength={200} onChange={(e) => set("name", e.target.value)} required />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id("description")}>Descrição</Label>
        <Textarea id={id("description")} value={form.description} onChange={(e) => set("description", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={id("price")}>Preço sem IVA</Label>
          <Input id={id("price")} inputMode="decimal" value={form.salePrice} onChange={(e) => set("salePrice", e.target.value)} placeholder="Sob consulta" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("vat")}>IVA (%)</Label>
          <Input id={id("vat")} inputMode="decimal" list={id("vat-presets")} value={form.vatRate} onChange={(e) => set("vatRate", e.target.value)} />
          <datalist id={id("vat-presets")}>
            {VAT_PRESETS.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <span className="text-sm font-medium">Preço com IVA</span>
          <p className="py-2 text-sm tabular-nums">{formatMoney(withVat)}</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("unit")}>Unidade</Label>
          <Select id={id("unit")} value={form.unit} onChange={(e) => set("unit", e.target.value as ProductUnit)}>
            {Object.entries(UNIT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={id("category")}>Categoria</Label>
          <Select id={id("category")} value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">Sem categoria</option>
            {categories
              .filter((c) => c.active || c.id === form.categoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (desativada)"}</option>
              ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("barcode")}>Código de barras</Label>
          <Input id={id("barcode")} value={form.barcode} maxLength={32} onChange={(e) => set("barcode", e.target.value)} className="font-mono" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id("min")}>Stock mínimo</Label>
          <Input id={id("min")} inputMode="decimal" value={form.minStock} onChange={(e) => set("minStock", e.target.value)} disabled={!form.tracksStock} placeholder="Para o alerta" />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.tracksStock} onChange={(e) => set("tracksStock", e.target.checked)} />
          Controla stock (não, em serviços e revenda direta)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
          Ativo
        </label>
      </div>
    </div>
  );
}
