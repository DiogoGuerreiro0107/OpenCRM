import type { Page, Product, ProductCategory, ProductUnit } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";

/** Catálogo de produtos (módulo produtos, Fase 5a). */

export interface ProductInput {
  sku?: string;
  barcode?: string | null;
  name?: string;
  description?: string | null;
  unit?: ProductUnit;
  salePrice?: number | null;
  vatRate?: number;
  categoryId?: string | null;
  active?: boolean;
  tracksStock?: boolean;
  minStock?: number | null;
}

export interface ProductFilters {
  search?: string;
  categoryId?: string;
  active?: "true" | "false" | "all";
  tracksStock?: "true" | "false";
  supplierId?: string;
  /** Alertas de stock (Fase 5b). */
  stock?: "below_min" | "negative";
}

export async function listProducts(filters: ProductFilters & PageParams) {
  const { data } = await api.get<Page<Product>>("/products", { params: filters });
  return data;
}

export async function getProduct(id: string) {
  const { data } = await api.get<Product>(`/products/${id}`);
  return data;
}

export async function createProduct(input: ProductInput & { sku: string; name: string }) {
  const { data } = await api.post<Product>("/products", input);
  return data;
}

export async function updateProduct(id: string, input: ProductInput) {
  const { data } = await api.patch<Product>(`/products/${id}`, input);
  return data;
}

export async function deleteProduct(id: string) {
  await api.delete(`/products/${id}`);
}

export async function addProductSupplier(productId: string, input: { companyId: string; supplierSku?: string | null; costPrice?: number | null; preferred?: boolean }) {
  const { data } = await api.post<Product>(`/products/${productId}/suppliers`, input);
  return data;
}

export async function updateProductSupplier(productId: string, supplierId: string, input: { supplierSku?: string | null; costPrice?: number | null; preferred?: boolean }) {
  const { data } = await api.patch<Product>(`/products/${productId}/suppliers/${supplierId}`, input);
  return data;
}

export async function removeProductSupplier(productId: string, supplierId: string) {
  await api.delete(`/products/${productId}/suppliers/${supplierId}`);
}

export async function listProductCategories() {
  const { data } = await api.get<ProductCategory[]>("/product-categories");
  return data;
}

export async function createProductCategory(input: { name: string; sortOrder?: number }) {
  const { data } = await api.post<ProductCategory>("/product-categories", input);
  return data;
}

export async function updateProductCategory(id: string, input: { name?: string; sortOrder?: number; active?: boolean }) {
  const { data } = await api.patch<ProductCategory>(`/product-categories/${id}`, input);
  return data;
}

export async function deleteProductCategory(id: string) {
  await api.delete(`/product-categories/${id}`);
}

export const UNIT_LABELS: Record<ProductUnit, string> = { UN: "Unidade", CX: "Caixa", PACK: "Pack", KG: "Kg", M: "Metro", L: "Litro", H: "Hora" };

/** Taxas de IVA em Portugal (continente, Madeira, Açores): atalhos; aceita-se outra. */
export const VAT_PRESETS = [23, 13, 6, 0, 22, 12, 5, 16, 9, 4];

/** «45,90 €». */
export const formatMoney = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined ? "—" : value.toLocaleString("pt-PT", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 2) });

/** «1,5» ou «1.5» → 1.5; vazio → null; inválido → NaN. */
export function parseDecimal(value: string): number | null {
  const v = value.trim().replace(/\s/g, "").replace(",", ".");
  return v === "" ? null : Number(v);
}

/** Número para um campo de texto («45,9»). */
export const decimalInput = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value).replace(".", ","));
