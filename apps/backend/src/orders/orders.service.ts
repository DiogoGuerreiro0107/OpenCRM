import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SalesOrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { foldSearch } from "../common/search-text";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import { lockedTransaction } from "../common/locked-transaction";
import { monotonicNow } from "../common/monotonic-clock";
import { orderCode } from "./order-code";
import { OrderPreparationService } from "./order-preparation.service";
import { onOrderByProduct } from "../purchases/purchases.service";
import { recordMovement } from "../stock/stock.service";
import { allocateWaiting, lockProducts, reservationText, SALES_ORDER_SOURCE, waitingLines } from "../stock/reservations";
import { WebhooksService } from "../webhooks/webhooks.service";
import { trackingUrl } from "./carriers.service";
import { linkExternalId, OrderIntake, resolveCustomer, resolveLines } from "./order-intake";
import { apiKeyProvider } from "../public-api/external-provider";
import { CancelOrderDto, CreateOrderDto, CreateOrderLineDto, FinishOrderDto, QueryOrdersDto, ShipOrderDto, UpdateOrderDto, UpdateOrderLineDto, UpdateShipmentDto } from "./dto/order.dto";

/** No máximo isto por encomenda: as linhas vêm sempre todas com a encomenda. */
export const MAX_LINES_PER_ORDER = 200;

export { orderCode };

const D = Prisma.Decimal;
const round2 = (n: number) => Math.round(n * 100) / 100;
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Total da linha sem IVA (com o desconto) e o IVA da linha, arredondados a cêntimos (Fase 6a). */
export function computeLine(input: { quantity: number | Prisma.Decimal; unitPrice: number | Prisma.Decimal; discountPct: number | Prisma.Decimal; vatRate: number | Prisma.Decimal }) {
  const net = cents(new D(input.quantity).times(input.unitPrice).times(new D(100).minus(input.discountPct)).dividedBy(100));
  const vat = cents(net.times(input.vatRate).dividedBy(100));
  return { net, vat };
}

/** Totais da encomenda: soma das linhas (cada uma já arredondada). */
export function computeTotals(lines: Array<Parameters<typeof computeLine>[0]>) {
  let subtotal = new D(0);
  let vatTotal = new D(0);
  for (const line of lines) {
    const { net, vat } = computeLine(line);
    subtotal = subtotal.plus(net);
    vatTotal = vatTotal.plus(vat);
  }
  return { subtotal, vatTotal, total: subtotal.plus(vatTotal) };
}

/** Transições permitidas: de → para. Não se volta atrás. */
const NEXT = {
  confirm: { from: "DRAFT", to: "CONFIRMED" },
  ship: { from: "CONFIRMED", to: "SHIPPED" },
  deliver: { from: "SHIPPED", to: "DELIVERED" },
} as const satisfies Record<string, { from: SalesOrderStatus; to: SalesOrderStatus }>;

const STATUS_LABEL: Record<SalesOrderStatus, string> = {
  DRAFT: "rascunho",
  CONFIRMED: "confirmada",
  SHIPPED: "enviada",
  DELIVERED: "entregue",
  CANCELLED: "cancelada",
};

const pt = (n: number, digits = 2) => n.toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: digits });

/** «CTT · código AB123 · 2 volumes · 3,5 kg · 7,90 €»: o transporte de uma expedição, para a timeline (Fase 6d). */
export function transportText(s: { carrierName?: string | null; trackingCode?: string | null; packages?: number | null; weightKg?: number | null; cost?: number | null }) {
  const parts: string[] = [];
  if (s.carrierName) parts.push(s.carrierName);
  if (s.trackingCode) parts.push(`código ${s.trackingCode}`);
  if (s.packages != null) parts.push(`${s.packages} ${s.packages === 1 ? "volume" : "volumes"}`);
  if (s.weightKg != null) parts.push(`${pt(s.weightKg)} kg`);
  if (s.cost != null) parts.push(`${s.cost.toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  return parts.join(" · ");
}

const PARTY = {
  company: { select: { id: true, name: true, taxId: true } },
  contact: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true } },
} as const;
const LINE_ORDER: Prisma.SalesOrderLineOrderByWithRelationInput[] = [{ position: "asc" }, { id: "asc" }];
const LINE_PRODUCT = { product: { select: { id: true, tracksStock: true, stockOnHand: true, reserved: true } } } as const;
/** Expedição com a transportadora e as linhas (Fase 6d). */
const SHIPMENT = {
  carrier: { select: { id: true, name: true, trackingUrlTemplate: true } },
  createdBy: { select: { id: true, name: true } },
  lines: { include: { orderLine: { select: { id: true, position: true, productId: true, sku: true, description: true } } } },
} satisfies Prisma.ShipmentInclude;
const SHIPMENT_ORDER: Prisma.ShipmentOrderByWithRelationInput[] = [{ shippedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }];
const DETAIL = {
  ...PARTY,
  createdBy: { select: { id: true, name: true } },
  lines: { orderBy: LINE_ORDER, include: LINE_PRODUCT },
  shipments: { orderBy: SHIPMENT_ORDER, include: SHIPMENT },
} satisfies Prisma.SalesOrderInclude;
const LIST = { ...PARTY, _count: { select: { lines: true, shipments: true } } } as const;

type DetailRow = Prisma.SalesOrderGetPayload<{ include: typeof DETAIL }>;
type ListRow = Prisma.SalesOrderGetPayload<{ include: typeof LIST }>;
type LineRow = DetailRow["lines"][number];
type ShipmentRow = Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT }>;
type Tx = Prisma.TransactionClient;

/** Mais recentes primeiro. */
const LIST_KEY: KeyField[] = [
  { field: "createdAt", dir: "desc", kind: "date" },
  { field: "id", dir: "desc", kind: "string" },
];

/**
 * Encomendas de cliente (Fase 6a, docs/plano-fase-6-encomendas.md). Estados fixos em código; as linhas só mudam em
 * rascunho, com a encomenda bloqueada para os totais (recalculados pelo servidor) não se pisarem. Valores indicativos.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly preparation: OrderPreparationService,
    private readonly webhooks: WebhooksService,
  ) {}

  /** As encomendas reservam e gastam stock (Fase 6b) com o módulo «Stock» ligado (as encomendas estão, se cá chegou). */
  private reservationsApply() {
    return this.modules.isEnabled("stock") && this.modules.isEnabled("encomendas");
  }

  /**
   * Linha que aguarda stock: produto que controla stock e reserva abaixo do que falta enviar (numa encomenda
   * confirmada; Fase 6d: depois de um envio parcial, só o resto).
   */
  private waitingLineWhere(): Prisma.SalesOrderLineWhereInput {
    return { product: { tracksStock: true }, reservedQuantity: { lt: this.prisma.salesOrderLine.fields.unshippedQuantity } };
  }

  private lineView(line: LineRow, status: SalesOrderStatus) {
    const { vat } = computeLine(line);
    const { product, ...rest } = line;
    const quantity = Number(line.quantity);
    const reserved = Number(line.reservedQuantity);
    const unshipped = Number(line.unshippedQuantity);
    return {
      ...rest,
      quantity,
      unitPrice: Number(line.unitPrice),
      discountPct: Number(line.discountPct),
      vatRate: Number(line.vatRate),
      lineTotal: Number(line.lineTotal),
      vatAmount: Number(vat),
      reservedQuantity: reserved,
      shippedQuantity: Number(line.shippedQuantity),
      unshippedQuantity: unshipped,
      waitingQuantity: status === "CONFIRMED" && product?.tracksStock ? round2(unshipped - reserved) : 0,
      product: product
        ? { id: product.id, tracksStock: product.tracksStock, stockOnHand: Number(product.stockOnHand), reserved: Number(product.reserved), available: round2(Number(product.stockOnHand) - Number(product.reserved)) }
        : null,
    };
  }

  private money<T extends { subtotal: Prisma.Decimal; vatTotal: Prisma.Decimal; total: Prisma.Decimal; number: number }>(o: T) {
    return { ...o, code: orderCode(o.number), subtotal: Number(o.subtotal), vatTotal: Number(o.vatTotal), total: Number(o.total) };
  }

  private shipmentView(s: ShipmentRow) {
    const { carrier, lines, ...rest } = s;
    return {
      ...rest,
      weightKg: s.weightKg === null ? null : Number(s.weightKg),
      cost: s.cost === null ? null : Number(s.cost),
      carrier: carrier ? { id: carrier.id, name: carrier.name } : null,
      trackingUrl: trackingUrl(carrier?.trackingUrlTemplate, s.trackingCode),
      lines: [...lines]
        .sort((a, b) => a.orderLine.position - b.orderLine.position || a.orderLine.id.localeCompare(b.orderLine.id))
        .map((l) => ({ id: l.id, orderLineId: l.orderLineId, productId: l.orderLine.productId, sku: l.orderLine.sku, description: l.orderLine.description, quantity: Number(l.quantity) })),
    };
  }

  private detailView(o: DetailRow) {
    const { shipments, ...rest } = o;
    const lines = o.lines.map((l) => this.lineView(l, o.status));
    return {
      ...this.money(rest),
      lines,
      waitingLines: lines.filter((l) => l.waitingQuantity > 0).length,
      shipments: shipments.map((s) => this.shipmentView(s)),
      partiallyShipped: o.status === "CONFIRMED" && shipments.length > 0,
    };
  }

  private listView(o: ListRow, waiting: Map<string, number>) {
    const { _count, ...rest } = o;
    return {
      ...this.money(rest),
      lineCount: _count.lines,
      waitingLines: o.status === "CONFIRMED" ? (waiting.get(o.id) ?? 0) : 0,
      partiallyShipped: o.status === "CONFIRMED" && _count.shipments > 0,
    };
  }

  /** O essencial da encomenda para os webhooks (Fase 6d). */
  private eventBase(o: { id: string; code: string; status: SalesOrderStatus; companyId: string | null; contactId: string | null; customerReference: string | null; total: number }) {
    return { orderId: o.id, code: o.code, status: o.status, companyId: o.companyId, contactId: o.contactId, customerReference: o.customerReference, total: o.total };
  }

  private statusChanged(order: Parameters<OrdersService["eventBase"]>[0], from: SalesOrderStatus, reason?: string) {
    this.webhooks.trigger("order.status_changed", { ...this.eventBase(order), from, to: order.status, ...(reason ? { reason } : {}) });
  }

  /** Para os webhooks: a expedição sem o custo (é interno). */
  private shipmentEvent(s: ReturnType<OrdersService["shipmentView"]>) {
    return {
      id: s.id,
      shippedAt: s.shippedAt,
      carrier: s.carrier?.name ?? null,
      trackingCode: s.trackingCode,
      trackingUrl: s.trackingUrl,
      packages: s.packages,
      weightKg: s.weightKg,
      lines: s.lines.map((l) => ({ orderLineId: l.orderLineId, productId: l.productId, sku: l.sku, description: l.description, quantity: l.quantity })),
    };
  }

  async findPage(query: QueryOrdersDto) {
    const where: Prisma.SalesOrderWhereInput = {};
    const term = query.search?.trim();
    if (term) {
      const folded = foldSearch(term);
      const number = /^(?:en-?)?0*(\d{1,9})$/i.exec(term);
      where.OR = [
        ...(number ? [{ number: Number(number[1]) }] : []),
        { searchText: { contains: folded } },
        { company: { searchText: { contains: folded } } },
        { contact: { searchText: { contains: folded } } },
      ];
    }
    if (query.status) where.status = query.status;
    if (query.companyId) where.companyId = query.companyId;
    if (query.contactId) where.contactId = query.contactId;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    const and: Prisma.SalesOrderWhereInput[] = [];
    // «A aguardar stock» (Fase 6b): confirmadas com alguma linha à espera.
    if (query.waiting === "true") and.push({ status: "CONFIRMED", lines: { some: this.waitingLineWhere() } });
    // «Pronta a preparar» (Fase 6c): confirmadas sem nenhuma linha à espera.
    if (query.ready === "true") and.push({ status: "CONFIRMED", lines: { none: this.waitingLineWhere() } });
    // «Parcialmente enviada» (Fase 6d): confirmadas com alguma expedição.
    if (query.partiallyShipped === "true") and.push({ status: "CONFIRMED", shipments: { some: {} } });
    if (query.productId) and.push({ lines: { some: { productId: query.productId } } });
    if (and.length) where.AND = and;
    const page = await readPage(LIST_KEY, query, (after, take) =>
      this.prisma.salesOrder.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(LIST_KEY), take, include: LIST }),
    );
    const confirmed = page.items.filter((o) => o.status === "CONFIRMED").map((o) => o.id);
    const waiting = new Map<string, number>();
    if (confirmed.length) {
      const counts = await this.prisma.salesOrderLine.groupBy({ by: ["orderId"], where: { orderId: { in: confirmed }, ...this.waitingLineWhere() }, _count: { _all: true } });
      for (const c of counts) waiting.set(c.orderId, c._count._all);
    }
    return { ...page, items: page.items.map((o) => this.listView(o, waiting)) };
  }

  /** Nas linhas à espera, o que está em compra do produto (com o módulo «Compras» ligado — Fase 6c). */
  async findOne(id: string) {
    const view = { ...this.detailView(await this.load(id)), externalRefs: await this.externalRefs(id) };
    const waitingProducts = [...new Set(view.lines.filter((l) => l.waitingQuantity > 0).map((l) => l.productId!))];
    if (!waitingProducts.length || !this.modules.isEnabled("compras")) return view;
    const onOrder = await onOrderByProduct(this.prisma, waitingProducts);
    return { ...view, lines: view.lines.map((l) => (l.waitingQuantity > 0 && l.product ? { ...l, product: { ...l.product, onOrder: onOrder.get(l.product.id) ?? 0 } } : l)) };
  }

  /** Ids externos da encomenda (Fase 6e): o número na loja que a enviou pela API, com o nome da chave. */
  private async externalRefs(id: string) {
    const links = await this.prisma.externalLink.findMany({ where: { entityType: "order", entityId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!links.length) return [];
    const keyIds = links.map((l) => l.provider).filter((p) => p.startsWith("api_key:")).map((p) => p.slice("api_key:".length));
    const keys = new Map((await this.prisma.apiKey.findMany({ where: { id: { in: keyIds } }, select: { id: true, name: true } })).map((k) => [apiKeyProvider(k.id), k.name]));
    return links.map((l) => ({ source: keys.get(l.provider) ?? l.provider, externalId: l.externalId }));
  }

  private async load(id: string, tx: Tx | PrismaService = this.prisma) {
    const order = await tx.salesOrder.findUnique({ where: { id }, include: DETAIL });
    if (!order) throw new NotFoundException("Encomenda não encontrada");
    return order;
  }

  /** Bloqueia a encomenda até ao fim da transação e devolve o estado atual. */
  private async lock(tx: Tx, id: string) {
    const [row] = await tx.$queryRaw<Array<{ id: string; number: number; status: SalesOrderStatus }>>`
      SELECT "id", "number", "status" FROM "SalesOrder" WHERE "id" = ${id} FOR UPDATE`;
    if (!row) throw new NotFoundException("Encomenda não encontrada");
    return row;
  }

  private note(tx: Tx | PrismaService, orderId: string, description: string, userId: string) {
    return tx.timelineEvent.create({ data: { entityType: "ORDER", entityId: orderId, type: "SYSTEM", description, userId, createdAt: monotonicNow() } });
  }

  /** Cliente válido: pelo menos um; existe; o contacto, se tiver empresa, é dessa empresa. */
  private async assertCustomer(companyId: string | null, contactId: string | null) {
    if (!companyId && !contactId) throw new BadRequestException("Indica o cliente (empresa ou contacto)");
    if (companyId && !(await this.prisma.company.count({ where: { id: companyId } }))) throw new BadRequestException("Empresa não encontrada");
    if (contactId) {
      const contact = await this.prisma.contact.findUnique({ where: { id: contactId }, select: { companyId: true } });
      if (!contact) throw new BadRequestException("Contacto não encontrado");
      if (companyId && contact.companyId && contact.companyId !== companyId) throw new BadRequestException("Esse contacto é de outra empresa");
    }
  }

  private async assertAssignee(assigneeId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: assigneeId }, select: { active: true } });
    if (!user) throw new BadRequestException("Responsável não encontrado");
    if (!user.active) throw new BadRequestException("Esse utilizador está desativado");
  }

  async create(dto: CreateOrderDto, userId: string) {
    const companyId = dto.companyId || null;
    const contactId = dto.contactId || null;
    await this.assertCustomer(companyId, contactId);
    if (dto.assigneeId) await this.assertAssignee(dto.assigneeId);
    const order = await lockedTransaction(this.prisma, async (tx) => {
      const created = await tx.salesOrder.create({
        data: {
          companyId,
          contactId,
          assigneeId: dto.assigneeId || null,
          customerReference: dto.customerReference?.trim() || null,
          deliveryAddress: dto.deliveryAddress?.trim() || null,
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
      });
      await this.note(tx, created.id, `Encomenda ${orderCode(created.number)} criada`, userId);
      return created;
    });
    const view = await this.findOne(order.id);
    this.webhooks.trigger("order.created", this.eventBase(view));
    return view;
  }

  async update(id: string, dto: UpdateOrderDto, userId: string) {
    const existing = await this.load(id);
    if (existing.status === "DELIVERED" || existing.status === "CANCELLED") {
      throw new ConflictException(`A encomenda está ${STATUS_LABEL[existing.status]}: já não se altera`);
    }
    const customerChanges = dto.companyId !== undefined || dto.contactId !== undefined;
    if (customerChanges) {
      if (existing.status !== "DRAFT") throw new ConflictException("O cliente só se muda enquanto a encomenda é rascunho");
      await this.assertCustomer(dto.companyId === undefined ? existing.companyId : dto.companyId, dto.contactId === undefined ? existing.contactId : dto.contactId);
    }
    if (dto.assigneeId) await this.assertAssignee(dto.assigneeId);
    const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
    await this.prisma.salesOrder.update({
      where: { id },
      data: {
        companyId: dto.companyId,
        contactId: dto.contactId,
        assigneeId: dto.assigneeId,
        customerReference: text(dto.customerReference),
        deliveryAddress: text(dto.deliveryAddress),
        notes: text(dto.notes),
      },
    });
    if (dto.assigneeId !== undefined && dto.assigneeId !== existing.assigneeId) {
      const name = dto.assigneeId ? (await this.prisma.user.findUnique({ where: { id: dto.assigneeId }, select: { name: true } }))?.name : null;
      await this.note(this.prisma, id, name ? `Responsável: ${name}` : "Sem responsável", userId);
    }
    return this.findOne(id);
  }

  async remove(id: string) {
    const existing = await this.load(id);
    if (existing.status !== "DRAFT") throw new ConflictException("Só se apagam rascunhos: cancela a encomenda");
    // Os valores dos campos personalizados e os ids externos (Fase 6e) não têm chave estrangeira (polimórficos):
    // apagam-se juntamente, e o id externo fica livre para a loja voltar a enviar a encomenda.
    await this.prisma.$transaction([
      this.prisma.customFieldValue.deleteMany({ where: { entityType: "ORDER", entityId: id } }),
      this.prisma.externalLink.deleteMany({ where: { entityType: "order", entityId: id } }),
      this.prisma.salesOrder.delete({ where: { id } }),
    ]);
  }

  // ---- Linhas (só em rascunho) ----

  /** Recalcula e guarda os totais a partir das linhas (dentro da transação com a encomenda bloqueada). */
  private async refreshTotals(tx: Tx, orderId: string) {
    const lines = await tx.salesOrderLine.findMany({ where: { orderId }, select: { quantity: true, unitPrice: true, discountPct: true, vatRate: true } });
    const totals = computeTotals(lines);
    await tx.salesOrder.update({ where: { id: orderId }, data: totals });
  }

  private async draftLock(tx: Tx, orderId: string) {
    const order = await this.lock(tx, orderId);
    if (order.status !== "DRAFT") throw new ConflictException("As linhas só se alteram enquanto a encomenda é rascunho");
    return order;
  }

  async addLine(orderId: string, dto: CreateOrderLineDto, userId: string) {
    await lockedTransaction(this.prisma, async (tx) => {
      await this.draftLock(tx, orderId);
      const count = await tx.salesOrderLine.count({ where: { orderId } });
      if (count >= MAX_LINES_PER_ORDER) throw new BadRequestException(`Uma encomenda tem no máximo ${MAX_LINES_PER_ORDER} linhas`);

      let product: { id: string; sku: string; name: string; salePrice: Prisma.Decimal | null; vatRate: Prisma.Decimal } | null = null;
      if (dto.productId) {
        if (!this.modules.isEnabled("produtos")) throw new BadRequestException("O módulo «Produtos» está desligado: descreve a linha à mão");
        const found = await tx.product.findUnique({ where: { id: dto.productId }, select: { id: true, sku: true, name: true, salePrice: true, vatRate: true, active: true } });
        if (!found) throw new BadRequestException("Produto não encontrado");
        if (!found.active) throw new BadRequestException("Esse produto está desativado");
        product = found;
      }
      const description = dto.description?.trim() || product?.name;
      if (!description) throw new BadRequestException("Descreve a linha");
      const unitPrice = dto.unitPrice ?? (product?.salePrice != null ? Number(product.salePrice) : undefined);
      if (unitPrice === undefined) throw new BadRequestException(product ? "Esse produto não tem preço: indica o preço" : "Indica o preço");
      const vatRate = dto.vatRate ?? (product ? Number(product.vatRate) : undefined);
      if (vatRate === undefined) throw new BadRequestException("Indica a taxa de IVA");
      const discountPct = dto.discountPct ?? 0;
      const last = await tx.salesOrderLine.aggregate({ where: { orderId }, _max: { position: true } });
      const line = await tx.salesOrderLine.create({
        data: {
          orderId,
          position: (last._max.position ?? -1) + 1,
          productId: product?.id ?? null,
          sku: dto.sku === undefined ? (product?.sku ?? null) : dto.sku?.trim() || null,
          description,
          quantity: dto.quantity,
          unitPrice,
          discountPct,
          vatRate,
          lineTotal: computeLine({ quantity: dto.quantity, unitPrice, discountPct, vatRate }).net,
        },
      });
      await this.refreshTotals(tx, orderId);
      await this.note(tx, orderId, `Linha acrescentada: ${lineText(line)}`, userId);
    });
    return this.findOne(orderId);
  }

  async updateLine(orderId: string, lineId: string, dto: UpdateOrderLineDto, userId: string) {
    await lockedTransaction(this.prisma, async (tx) => {
      await this.draftLock(tx, orderId);
      const existing = await tx.salesOrderLine.findFirst({ where: { id: lineId, orderId } });
      if (!existing) throw new NotFoundException("Linha não encontrada");
      const next = {
        quantity: dto.quantity ?? existing.quantity,
        unitPrice: dto.unitPrice ?? existing.unitPrice,
        discountPct: dto.discountPct ?? existing.discountPct,
        vatRate: dto.vatRate ?? existing.vatRate,
      };
      const line = await tx.salesOrderLine.update({
        where: { id: lineId },
        data: {
          description: dto.description?.trim(),
          sku: dto.sku === undefined ? undefined : dto.sku?.trim() || null,
          ...next,
          lineTotal: computeLine(next).net,
        },
      });
      await this.refreshTotals(tx, orderId);
      const before = lineText(existing);
      const after = lineText(line);
      if (before !== after) await this.note(tx, orderId, `Linha alterada: ${before} → ${after}`, userId);
    });
    return this.findOne(orderId);
  }

  async removeLine(orderId: string, lineId: string, userId: string) {
    await lockedTransaction(this.prisma, async (tx) => {
      await this.draftLock(tx, orderId);
      const existing = await tx.salesOrderLine.findFirst({ where: { id: lineId, orderId } });
      if (!existing) throw new NotFoundException("Linha não encontrada");
      await tx.salesOrderLine.delete({ where: { id: lineId } });
      await this.refreshTotals(tx, orderId);
      await this.note(tx, orderId, `Linha retirada: ${lineText(existing)}`, userId);
    });
    return this.findOne(orderId);
  }

  // ---- Estados ----

  private assertFrom(order: { status: SalesOrderStatus }, step: keyof typeof NEXT) {
    const t = NEXT[step];
    if (order.status !== t.from) {
      throw new ConflictException(`A encomenda está ${STATUS_LABEL[order.status]}: não pode passar a ${STATUS_LABEL[t.to]}`);
    }
  }

  /** Produtos das linhas (ids), para os bloquear antes de mexer nas reservas. */
  private async lineProducts(tx: Tx, orderId: string) {
    const lines = await tx.salesOrderLine.findMany({ where: { orderId, productId: { not: null } }, select: { productId: true } });
    return [...new Set(lines.map((l) => l.productId!))].sort();
  }

  /**
   * Dá o disponível de cada produto às linhas à espera (das encomendas mais antigas para as mais recentes). Devolve as
   * encomendas servidas, para a tarefa «Preparar encomenda» depois de gravar (Fase 6c).
   */
  private async allocate(tx: Tx, productIds: string[], userId: string) {
    const served = new Set<string>();
    for (const productId of productIds) for (const orderId of (await allocateWaiting(tx, productId, userId)).keys()) served.add(orderId);
    return served;
  }

  /** Confirmar: reserva o disponível, por linha (Fase 6b); o resto aguarda stock. */
  async confirm(id: string, userId: string) {
    const served = await lockedTransaction(this.prisma, (tx) => this.confirmLocked(tx, id, userId));
    // Completa logo ao confirmar não pede tarefa (quem confirma já sabe); outras que fiquem completas, sim.
    served.delete(id);
    await this.preparation.afterAllocation(served, userId);
    const view = await this.findOne(id);
    this.statusChanged(view, "DRAFT");
    return view;
  }

  /** Confirma dentro da transação (também a das encomendas vindas da API, Fase 6e). Devolve as encomendas servidas. */
  private async confirmLocked(tx: Tx, id: string, userId: string) {
    const order = await this.lock(tx, id);
    this.assertFrom(order, "confirm");
    const full = await tx.salesOrder.findUniqueOrThrow({ where: { id }, select: { companyId: true, contactId: true, _count: { select: { lines: true } } } });
    if (full._count.lines === 0) throw new BadRequestException("Acrescenta pelo menos uma linha antes de confirmar");
    if (!full.companyId && !full.contactId) throw new BadRequestException("Indica o cliente antes de confirmar");
    const reserves = this.reservationsApply();
    const productIds = reserves ? await this.lineProducts(tx, id) : [];
    await lockProducts(tx, productIds);
    await tx.salesOrder.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
    await this.note(tx, id, "Encomenda confirmada", userId);
    if (!reserves) return new Set<string>();
    const served = await this.allocate(tx, productIds, userId);
    const waiting = await waitingLines(tx, id);
    if (waiting.length) {
      await this.note(tx, id, `A aguardar stock: ${waiting.map((l) => reservationText(round2(Number(l.quantity) - Number(l.reservedQuantity)), l)).join("; ")}`, userId);
    }
    return served;
  }

  /**
   * Encomenda vinda da API pública (Fase 6e): cliente (encontrado ou criado), linhas, e confirmada se pedido — tudo
   * numa transação. Depois de gravar faz o mesmo que a interface: webhooks e a tarefa «Preparar encomenda».
   */
  async createFromIntake(intake: OrderIntake, userId: string) {
    const { id } = intake;
    const served = await lockedTransaction(this.prisma, async (tx) => {
      await linkExternalId(tx, intake.externalLink, id);
      const customer = await resolveCustomer(tx, intake.customer);
      const lines = await resolveLines(tx, intake.lines);
      const totals = computeTotals(lines);
      const text = (v: string | undefined) => v?.trim() || null;
      const order = await tx.salesOrder.create({
        data: {
          id,
          companyId: customer.company?.id ?? null,
          contactId: customer.contact?.id ?? null,
          customerReference: text(intake.customerReference) ?? text(intake.externalLink?.externalId)?.slice(0, 100) ?? null,
          deliveryAddress: text(intake.deliveryAddress),
          notes: text(intake.notes),
          createdById: userId,
          ...totals,
          lines: {
            create: lines.map((l, position) => ({ ...l, position, lineTotal: computeLine(l).net })),
          },
        },
        select: { number: true },
      });
      const code = orderCode(order.number);
      const external = intake.externalLink ? ` (n.º na origem: ${intake.externalLink.externalId})` : "";
      await this.note(tx, id, `Encomenda ${code} criada pela ${intake.origin}${external}`, userId);
      for (const n of customer.notes) await this.note(tx, id, n, userId);
      await this.note(tx, id, `Linhas: ${lines.map((l) => lineText(l)).join("; ")}`, userId);
      const createdBy = `pela ${intake.origin}, com a encomenda ${code}`;
      if (customer.created.company && customer.company) {
        await tx.timelineEvent.create({ data: { entityType: "COMPANY", entityId: customer.company.id, type: "SYSTEM", description: `Empresa "${customer.company.name}" criada ${createdBy}.`, userId } });
      }
      if (customer.created.contact && customer.contact) {
        await tx.timelineEvent.create({ data: { entityType: "CONTACT", entityId: customer.contact.id, type: "SYSTEM", description: `Contacto "${customer.contact.name}" criado ${createdBy}.`, userId } });
      }
      return intake.confirm ? this.confirmLocked(tx, id, userId) : null;
    });
    const view = await this.findOne(id);
    this.webhooks.trigger("order.created", this.eventBase({ ...view, status: "DRAFT" }));
    if (served) {
      // Como na interface: completa logo ao confirmar não pede tarefa; outras que fiquem completas, sim.
      served.delete(id);
      await this.preparation.afterAllocation(served, userId);
      this.statusChanged(view, "DRAFT");
    }
    return view;
  }

  /** «Reservar stock»: para encomendas confirmadas sem as reservas todas (antes do 6b, ou com o stock desligado). */
  async reserve(id: string, userId: string) {
    if (!this.reservationsApply()) throw new BadRequestException("O módulo «Stock» está desligado: não há reservas");
    const served = await lockedTransaction(this.prisma, async (tx) => {
      const order = await this.lock(tx, id);
      if (order.status !== "CONFIRMED") throw new ConflictException("Só as encomendas confirmadas reservam stock");
      const productIds = await this.lineProducts(tx, id);
      await lockProducts(tx, productIds);
      return this.allocate(tx, productIds, userId);
    });
    await this.preparation.afterAllocation(served, userId);
    return this.findOne(id);
  }

  /**
   * Enviar (Fase 6d): regista uma expedição com tudo o que falta enviar ou só parte (`lines`). Por linha de produto
   * que controla stock (com o módulo «Stock» ligado) lança a saída da quantidade enviada; o reservado desce o que sai
   * (primeiro sai o reservado). Enviar mais do que o reservado só com `allowShortage` (o stock fica negativo). Com tudo
   * enviado, a encomenda passa a enviada; senão continua confirmada e o resto continua a aguardar.
   */
  async ship(id: string, dto: ShipOrderDto, userId: string) {
    const result = await lockedTransaction(this.prisma, async (tx) => {
      const order = await this.lock(tx, id);
      this.assertFrom(order, "ship");
      const carrier = await this.carrierFor(tx, dto.carrierId, null);
      const productIds = await this.lineProducts(tx, id);
      const products = await lockProducts(tx, productIds);
      const reserves = this.reservationsApply();
      // Relê as linhas só depois de bloquear os produtos: as reservas mudam com o produto bloqueado (6b).
      const all = await tx.salesOrderLine.findMany({ where: { orderId: id }, orderBy: LINE_ORDER });
      const picks = this.pickLines(all, dto.lines);
      if (!picks.length) throw new BadRequestException("Não há nada por enviar");
      const partial = picks.length !== all.filter((l) => Number(l.unshippedQuantity) > 0).length || picks.some((p) => p.quantity < Number(p.line.unshippedQuantity));

      const tracked = (line: (typeof all)[number]) => reserves && !!line.productId && !!products.get(line.productId)?.tracksStock;
      const short = picks.filter((p) => tracked(p.line) && p.quantity > Number(p.line.reservedQuantity));
      const shortage = short.map((p) => reservationText(round2(p.quantity - Number(p.line.reservedQuantity)), p.line)).join("; ");
      if (short.length && !dto.allowShortage) {
        throw new ConflictException(`Há linhas a aguardar stock (${shortage}): confirma o envio sem stock reservado`);
      }

      const code = orderCode(order.number);
      const out: string[] = [];
      for (const { line, quantity } of picks) {
        if (tracked(line)) {
          await recordMovement(tx, {
            productId: line.productId!,
            type: "SALE_OUT",
            quantity: -quantity,
            reason: partial ? `${code}: envio parcial` : `${code}: encomenda enviada`,
            sourceType: SALES_ORDER_SOURCE,
            sourceId: id,
            userId,
          });
          out.push(reservationText(quantity, line));
        }
        await tx.salesOrderLine.update({
          where: { id: line.id },
          data: { shippedQuantity: { increment: quantity }, reservedQuantity: Math.max(0, round2(Number(line.reservedQuantity) - quantity)) },
        });
      }
      const details = this.shipmentData(dto);
      const shipment = await tx.shipment.create({
        data: { orderId: id, carrierId: carrier?.id ?? null, ...details, shippedAt: new Date(), createdById: userId, lines: { create: picks.map((p) => ({ orderLineId: p.line.id, quantity: p.quantity })) } },
        select: { id: true },
      });
      // Um envio parcial também conta como alteração da encomenda (sincronização por data na API, Fase 6e).
      await tx.salesOrder.update({ where: { id }, data: partial ? { updatedAt: new Date() } : { status: "SHIPPED", shippedAt: new Date() } });
      await this.note(tx, id, partial ? `Envio parcial: ${picks.map((p) => reservationText(p.quantity, p.line)).join("; ")}` : "Encomenda enviada", userId);
      const transport = transportText({ carrierName: carrier?.name, ...details, weightKg: details.weightKg ?? null, cost: details.cost ?? null });
      if (transport) await this.note(tx, id, `Expedição: ${transport}`, userId);
      if (out.length) await this.note(tx, id, `Saída de stock: ${out.join("; ")}`, userId);
      if (short.length) await this.note(tx, id, `Enviada sem stock reservado para: ${shortage}`, userId);
      const served = reserves ? await this.allocate(tx, productIds, userId) : new Set<string>();
      return { served, shipmentId: shipment.id, partial };
    });
    await this.preparation.afterAllocation(result.served, userId);
    const view = await this.findOne(id);
    const shipment = view.shipments.find((s) => s.id === result.shipmentId)!;
    this.webhooks.trigger("order.shipped", { ...this.eventBase(view), partial: result.partial, shipment: this.shipmentEvent(shipment) });
    if (!result.partial) this.statusChanged(view, "CONFIRMED");
    return view;
  }

  /** O que sai em cada linha: o pedido (envio parcial) ou tudo o que falta enviar. Pela ordem das linhas. */
  private pickLines<L extends { id: string; description: string; unshippedQuantity: Prisma.Decimal }>(all: L[], requested: ShipOrderDto["lines"]) {
    if (!requested) return all.filter((l) => Number(l.unshippedQuantity) > 0).map((line) => ({ line, quantity: Number(line.unshippedQuantity) }));
    const index = new Map(all.map((l, i) => [l.id, i]));
    const seen = new Set<string>();
    const picks = requested.map((r) => {
      const i = index.get(r.lineId);
      if (i === undefined) throw new BadRequestException("Essa linha não é desta encomenda");
      if (seen.has(r.lineId)) throw new BadRequestException("Cada linha só aparece uma vez no envio");
      seen.add(r.lineId);
      const line = all[i];
      const left = Number(line.unshippedQuantity);
      if (r.quantity > left) throw new BadRequestException(left > 0 ? `${line.description}: só falta enviar ${pt(left)}` : `${line.description}: já foi enviada toda`);
      return { line, quantity: r.quantity, i };
    });
    return picks.sort((a, b) => a.i - b.i).map(({ line, quantity }) => ({ line, quantity }));
  }

  /** A transportadora pedida: `undefined` não mexe, `null`/vazio tira; tem de existir e estar ativa (exceto a atual). */
  private async carrierFor(tx: Tx, carrierId: string | null | undefined, current: string | null) {
    if (carrierId === undefined) return undefined;
    if (!carrierId) return null;
    const carrier = await tx.carrier.findUnique({ where: { id: carrierId }, select: { id: true, name: true, active: true } });
    if (!carrier) throw new BadRequestException("Transportadora não encontrada");
    if (!carrier.active && carrier.id !== current) throw new BadRequestException("Essa transportadora está desativada");
    return carrier;
  }

  /** Os dados do transporte do pedido; texto vazio = sem valor. Só os que vêm no pedido (na correção, o resto fica). */
  private shipmentData(dto: UpdateShipmentDto) {
    const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
    return {
      trackingCode: text(dto.trackingCode),
      packages: dto.packages,
      weightKg: dto.weightKg,
      cost: dto.cost,
      notes: text(dto.notes),
    };
  }

  /** Corrige os dados do transporte de uma expedição (Fase 6d), em qualquer estado da encomenda. */
  async updateShipment(id: string, shipmentId: string, dto: UpdateShipmentDto, userId: string) {
    const changed = await lockedTransaction(this.prisma, async (tx) => {
      await this.lock(tx, id);
      const existing = await tx.shipment.findFirst({ where: { id: shipmentId, orderId: id }, include: { carrier: { select: { name: true } } } });
      if (!existing) throw new NotFoundException("Expedição não encontrada");
      const carrier = await this.carrierFor(tx, dto.carrierId, existing.carrierId);
      const data = this.shipmentData(dto);
      const updated = await tx.shipment.update({ where: { id: shipmentId }, data: { ...data, carrierId: carrier === undefined ? undefined : (carrier?.id ?? null) }, include: { carrier: { select: { name: true } } } });
      const describe = (s: typeof updated) =>
        transportText({ carrierName: s.carrier?.name, trackingCode: s.trackingCode, packages: s.packages, weightKg: s.weightKg === null ? null : Number(s.weightKg), cost: s.cost === null ? null : Number(s.cost) }) + `|${s.notes ?? ""}`;
      if (describe(updated) === describe(existing)) return false;
      const transport = describe(updated).split("|")[0];
      await tx.salesOrder.update({ where: { id }, data: { updatedAt: new Date() } });
      await this.note(tx, id, `Expedição corrigida${transport ? `: ${transport}` : " (sem dados do transporte)"}`, userId);
      return true;
    });
    const view = await this.findOne(id);
    if (changed) this.webhooks.trigger("order.shipment_updated", { ...this.eventBase(view), shipment: this.shipmentEvent(view.shipments.find((s) => s.id === shipmentId)!) });
    return view;
  }

  /**
   * «Dar por enviada sem o resto» (Fase 6d): com parte já enviada, o que falta não vai. Liberta as reservas do resto e
   * o disponível vai para as encomendas à espera.
   */
  async finish(id: string, dto: FinishOrderDto, userId: string) {
    const reason = dto.reason.trim();
    const served = await lockedTransaction(this.prisma, async (tx) => {
      const order = await this.lock(tx, id);
      if (order.status !== "CONFIRMED") throw new ConflictException(`A encomenda está ${STATUS_LABEL[order.status]}: não se dá por enviada`);
      if ((await tx.shipment.count({ where: { orderId: id } })) === 0) throw new ConflictException("Ainda não foi enviado nada: cancela a encomenda");
      const productIds = await this.lineProducts(tx, id);
      await lockProducts(tx, productIds);
      const left = await tx.salesOrderLine.findMany({ where: { orderId: id, unshippedQuantity: { gt: 0 } }, orderBy: LINE_ORDER });
      const reserved = left.filter((l) => Number(l.reservedQuantity) > 0);
      if (reserved.length) await tx.salesOrderLine.updateMany({ where: { orderId: id, reservedQuantity: { gt: 0 } }, data: { reservedQuantity: 0 } });
      await tx.salesOrder.update({ where: { id }, data: { status: "SHIPPED", shippedAt: new Date() } });
      await this.note(tx, id, `Dada por enviada sem o resto: ${reason}`, userId);
      if (left.length) await this.note(tx, id, `Não vai: ${left.map((l) => reservationText(Number(l.unshippedQuantity), l)).join("; ")}`, userId);
      if (reserved.length) await this.note(tx, id, `Reservas libertadas: ${reserved.map((l) => reservationText(Number(l.reservedQuantity), l)).join("; ")}`, userId);
      return this.reservationsApply() ? this.allocate(tx, [...new Set(reserved.map((l) => l.productId!))].sort(), userId) : new Set<string>();
    });
    await this.preparation.afterAllocation(served, userId);
    const view = await this.findOne(id);
    this.statusChanged(view, "CONFIRMED", reason);
    return view;
  }

  async deliver(id: string, userId: string) {
    await lockedTransaction(this.prisma, async (tx) => {
      const order = await this.lock(tx, id);
      this.assertFrom(order, "deliver");
      await tx.salesOrder.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
      await this.note(tx, id, "Encomenda entregue", userId);
    });
    const view = await this.findOne(id);
    this.statusChanged(view, "SHIPPED");
    return view;
  }

  /** Cancelar liberta as reservas, e o que fica disponível vai para as encomendas à espera (Fase 6b). */
  async cancel(id: string, dto: CancelOrderDto, userId: string) {
    const reason = dto.reason.trim();
    const { served, from } = await lockedTransaction(this.prisma, async (tx) => {
      const order = await this.lock(tx, id);
      if (order.status !== "DRAFT" && order.status !== "CONFIRMED") {
        throw new ConflictException(`A encomenda está ${STATUS_LABEL[order.status]}: já não se cancela`);
      }
      if ((await tx.shipment.count({ where: { orderId: id } })) > 0) {
        throw new ConflictException("Já saiu parte da encomenda: dá-a por enviada sem o resto");
      }
      const productIds = order.status === "CONFIRMED" ? await this.lineProducts(tx, id) : [];
      await lockProducts(tx, productIds);
      const reserved = await tx.salesOrderLine.findMany({ where: { orderId: id, reservedQuantity: { gt: 0 } }, orderBy: LINE_ORDER });
      if (reserved.length) await tx.salesOrderLine.updateMany({ where: { orderId: id, reservedQuantity: { gt: 0 } }, data: { reservedQuantity: 0 } });
      await tx.salesOrder.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
      await this.note(tx, id, `Encomenda cancelada: ${reason}`, userId);
      if (reserved.length) await this.note(tx, id, `Reservas libertadas: ${reserved.map((l) => reservationText(Number(l.reservedQuantity), l)).join("; ")}`, userId);
      const served = this.reservationsApply() ? await this.allocate(tx, [...new Set(reserved.map((l) => l.productId!))].sort(), userId) : new Set<string>();
      return { served, from: order.status };
    });
    await this.preparation.afterAllocation(served, userId);
    const view = await this.findOne(id);
    this.statusChanged(view, from, reason);
    return view;
  }
}

/** «2 × Toner (TN-2420) a 45,90 € −10%»: para a timeline. */
export function lineText(line: { quantity: Prisma.Decimal | number; description: string; sku: string | null; unitPrice: Prisma.Decimal | number; discountPct: Prisma.Decimal | number }) {
  const discount = Number(line.discountPct);
  return `${pt(Number(line.quantity))} × ${line.description}${line.sku ? ` (${line.sku})` : ""} a ${Number(line.unitPrice).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €${discount ? ` −${pt(discount)}%` : ""}`;
}
