import { Company, Contact, Lead, Prisma } from "@prisma/client";
import { orderCode } from "../orders/order-code";
import { trackingUrl } from "../orders/carriers.service";

/**
 * Representações PÚBLICAS (contrato da v1). Escritas à mão, em snake_case, em vez de devolver o modelo da base de
 * dados: uma mudança interna não quebra integrações, e nada sai por engano. Dentro da v1 só se ACRESCENTAM campos.
 */
const iso = (d: Date) => d.toISOString();

export function publicCompany(c: Company) {
  return {
    id: c.id,
    name: c.name,
    legal_name: c.legalName,
    tax_id: c.taxId,
    website: c.website,
    phone: c.phone,
    email: c.email,
    address: c.address,
    postal_code: c.postalCode,
    city: c.city,
    country: c.country,
    status: c.status,
    source: c.source,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

export function publicContact(c: Contact) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    mobile_phone: c.mobilePhone,
    job_title: c.jobTitle,
    department: c.department,
    preferred_channel: c.preferredChannel,
    is_decision_maker: c.isDecisionMaker,
    marketing_consent: c.marketingConsent,
    company_id: c.companyId,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

/** `externalId`: o id externo desta integração para o lead, se houver (ExternalLink). */
export function publicLead(l: Omit<Lead, "nextActionSort" | "searchText">, externalId: string | null = null) {
  return {
    id: l.id,
    kind: l.kind,
    name: l.name,
    company_name: l.companyName,
    tax_id: l.taxId,
    phone: l.phone,
    email: l.email,
    source: l.source,
    interest: l.interest,
    status: l.status,
    notes: l.notes,
    external_id: externalId,
    created_at: iso(l.createdAt),
    updated_at: iso(l.updatedAt),
  };
}

// ---------- Produtos e encomendas (Fase 6e) ----------

const num = (d: Prisma.Decimal) => Number(d);
const numOrNull = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const isoOrNull = (d: Date | null) => (d === null ? null : d.toISOString());

export const PUBLIC_PRODUCT_INCLUDE = { category: { select: { id: true, name: true } } } satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof PUBLIC_PRODUCT_INCLUDE }>;

/**
 * Produto para integrações: NUNCA os custos nem os fornecedores. O stock só com o módulo «Stock» ligado
 * (`withStock`); num produto que não controla stock os três campos vêm a null.
 */
export function publicProduct(p: ProductRow, withStock: boolean) {
  const stock = withStock && p.tracksStock;
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    barcode: p.barcode,
    unit: p.unit,
    sale_price: numOrNull(p.salePrice),
    vat_rate: num(p.vatRate),
    active: p.active,
    tracks_stock: p.tracksStock,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    stock_on_hand: stock ? num(p.stockOnHand) : null,
    reserved: stock ? num(p.reserved) : null,
    available: stock ? Math.round((num(p.stockOnHand) - num(p.reserved)) * 100) / 100 : null,
    created_at: iso(p.createdAt),
    updated_at: iso(p.updatedAt),
  };
}

export const PUBLIC_ORDER_INCLUDE = {
  lines: { orderBy: [{ position: "asc" }, { id: "asc" }] },
  shipments: {
    orderBy: [{ shippedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    include: {
      carrier: { select: { name: true, trackingUrlTemplate: true } },
      lines: { include: { orderLine: { select: { id: true, position: true, sku: true, description: true } } } },
    },
  },
} satisfies Prisma.SalesOrderInclude;
type OrderRow = Prisma.SalesOrderGetPayload<{ include: typeof PUBLIC_ORDER_INCLUDE }>;

/**
 * Encomenda para integrações. SEM o custo das expedições (como nos webhooks), as notas internas, quem a criou ou o
 * responsável. `externalId`: o id que esta chave lhe deu, se houver.
 */
export function publicOrder(o: OrderRow, externalId: string | null) {
  return {
    id: o.id,
    code: orderCode(o.number),
    status: o.status,
    partially_shipped: o.status === "CONFIRMED" && o.shipments.length > 0,
    customer: { company_id: o.companyId, contact_id: o.contactId },
    customer_reference: o.customerReference,
    delivery_address: o.deliveryAddress,
    subtotal: num(o.subtotal),
    vat_total: num(o.vatTotal),
    total: num(o.total),
    external_id: externalId,
    lines: o.lines.map((l) => ({
      id: l.id,
      product_id: l.productId,
      sku: l.sku,
      description: l.description,
      quantity: num(l.quantity),
      unit_price: num(l.unitPrice),
      discount_pct: num(l.discountPct),
      vat_rate: num(l.vatRate),
      line_total: num(l.lineTotal),
      shipped_quantity: num(l.shippedQuantity),
    })),
    shipments: o.shipments.map((s) => ({
      id: s.id,
      shipped_at: iso(s.shippedAt),
      carrier: s.carrier?.name ?? null,
      tracking_code: s.trackingCode,
      tracking_url: trackingUrl(s.carrier?.trackingUrlTemplate, s.trackingCode),
      packages: s.packages,
      weight_kg: numOrNull(s.weightKg),
      lines: [...s.lines]
        .sort((a, b) => a.orderLine.position - b.orderLine.position || a.orderLine.id.localeCompare(b.orderLine.id))
        .map((l) => ({ order_line_id: l.orderLineId, sku: l.orderLine.sku, description: l.orderLine.description, quantity: num(l.quantity) })),
    })),
    confirmed_at: isoOrNull(o.confirmedAt),
    shipped_at: isoOrNull(o.shippedAt),
    delivered_at: isoOrNull(o.deliveredAt),
    cancelled_at: isoOrNull(o.cancelledAt),
    cancel_reason: o.cancelReason,
    created_at: iso(o.createdAt),
    updated_at: iso(o.updatedAt),
  };
}
