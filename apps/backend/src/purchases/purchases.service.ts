import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, PurchaseOrderStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { PermissionsService } from "../auth/permissions.service";
import { foldSearch } from "../common/search-text";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import { lockedTransaction } from "../common/locked-transaction";
import { monotonicNow } from "../common/monotonic-clock";
import { recordMovement } from "../stock/stock.service";
import { allocateWaiting, lockProducts, reservationText } from "../stock/reservations";
import { orderCode } from "../orders/order-code";
import { OrderPreparationService } from "../orders/order-preparation.service";
import {
  ClosePurchaseDto,
  CreatePurchaseLineDto,
  CreatePurchaseOrderDto,
  GeneratePurchasesDto,
  QueryPurchaseOrdersDto,
  ReceivePurchaseDto,
  UpdatePurchaseLineDto,
  UpdatePurchaseOrderDto,
} from "./dto/purchase.dto";

/** No máximo isto por compra: as linhas vêm sempre todas com a compra. */
export const MAX_LINES_PER_PURCHASE = 200;

/** Origem dos movimentos de stock lançados pelas receções. */
export const PURCHASE_ORDER_SOURCE = "PURCHASE_ORDER";

export const purchaseCode = (n: number) => `CF-${String(n).padStart(4, "0")}`;

const D = Prisma.Decimal;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** Total da linha: quantidade × custo, arredondado a cêntimos. */
export const purchaseLineTotal = (quantity: number | Prisma.Decimal, unitCost: number | Prisma.Decimal) =>
  new D(quantity).times(unitCost).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "em rascunho",
  SENT: "enviada",
  RECEIVED: "recebida",
  CLOSED: "fechada",
  CANCELLED: "cancelada",
};
/** Compras que ainda contam como «em compra». */
const OPEN: PurchaseOrderStatus[] = ["DRAFT", "SENT"];

const LINE_ORDER: Prisma.PurchaseOrderLineOrderByWithRelationInput[] = [{ position: "asc" }, { id: "asc" }];
const DETAIL = {
  supplier: { select: { id: true, name: true, taxId: true } },
  createdBy: { select: { id: true, name: true } },
  lines: { orderBy: LINE_ORDER, include: { product: { select: { id: true, tracksStock: true, active: true } } } },
} satisfies Prisma.PurchaseOrderInclude;
const LIST = { supplier: { select: { id: true, name: true } }, _count: { select: { lines: true } } } satisfies Prisma.PurchaseOrderInclude;

type DetailRow = Prisma.PurchaseOrderGetPayload<{ include: typeof DETAIL }>;
type ListRow = Prisma.PurchaseOrderGetPayload<{ include: typeof LIST }>;
type LineRow = DetailRow["lines"][number];
type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

/** Mais recentes primeiro. */
const LIST_KEY: KeyField[] = [
  { field: "createdAt", dir: "desc", kind: "date" },
  { field: "id", dir: "desc", kind: "string" },
];

/** Em compra, por produto: o que falta receber nas compras em rascunho ou enviadas. */
export async function onOrderByProduct(db: Db, productIds: string[]) {
  const map = new Map<string, number>();
  if (!productIds.length) return map;
  const rows = await db.purchaseOrderLine.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds }, purchaseOrder: { status: { in: OPEN } } },
    _sum: { quantity: true, receivedQuantity: true },
  });
  for (const r of rows) map.set(r.productId, round2(Number(r._sum.quantity ?? 0) - Number(r._sum.receivedQuantity ?? 0)));
  return map;
}

type Need = {
  productId: string;
  waiting: number;
  overReserved: number;
  onOrder: number;
  need: number;
  orders: Array<{ id: string; number: number }>;
};

/**
 * O que comprar para as encomendas (Fase 6c), por produto que controla stock: a aguardar nas encomendas confirmadas +
 * reservado acima do stock − em compra. `only` limita aos produtos dados (com eles bloqueados, na geração).
 */
async function computeNeeds(db: Db, only?: string[]): Promise<Need[]> {
  const filter = only ? Prisma.sql`AND p."id" IN (${Prisma.join(only.length ? only : [""])})` : Prisma.empty;
  const waiting = await db.$queryRaw<Array<{ productId: string; waiting: Prisma.Decimal; orders: Array<{ id: string; number: number }> }>>`
    SELECT l."productId", SUM(l."quantity" - l."reservedQuantity") AS "waiting",
           json_agg(DISTINCT jsonb_build_object('id', o."id", 'number', o."number")) AS "orders"
    FROM "SalesOrderLine" l
    JOIN "SalesOrder" o ON o."id" = l."orderId"
    JOIN "Product" p ON p."id" = l."productId"
    WHERE o."status" = 'CONFIRMED' AND p."tracksStock" AND l."reservedQuantity" < l."quantity" ${filter}
    GROUP BY l."productId"`;
  const over = await db.$queryRaw<Array<{ id: string; over: Prisma.Decimal }>>`
    SELECT p."id", p."reserved" - p."stockOnHand" AS "over" FROM "Product" p
    WHERE p."tracksStock" AND p."reserved" > p."stockOnHand" ${filter}`;
  const byProduct = new Map<string, Need>();
  const entry = (productId: string) => {
    let e = byProduct.get(productId);
    if (!e) byProduct.set(productId, (e = { productId, waiting: 0, overReserved: 0, onOrder: 0, need: 0, orders: [] }));
    return e;
  };
  for (const w of waiting) {
    const e = entry(w.productId);
    e.waiting = round2(Number(w.waiting));
    e.orders = [...w.orders].sort((a, b) => a.number - b.number);
  }
  for (const o of over) entry(o.id).overReserved = round2(Number(o.over));
  const onOrder = await onOrderByProduct(db, [...byProduct.keys()]);
  for (const e of byProduct.values()) {
    e.onOrder = onOrder.get(e.productId) ?? 0;
    e.need = round2(e.waiting + e.overReserved - e.onOrder);
  }
  return [...byProduct.values()].filter((e) => e.need > 0);
}

/**
 * Compras a fornecedor (Fase 6c, docs/plano-fase-6-encomendas.md). Estados fixos em código; as linhas só mudam em
 * rascunho, com a compra bloqueada. A receção lança as entradas de stock e serve as encomendas à espera pela regra
 * única do 6b. Custos e totais só para quem tem a área «Catálogo de produtos».
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly permissions: PermissionsService,
    private readonly preparation: OrderPreparationService,
  ) {}

  /** A mesma regra dos produtos: quem escreve no catálogo vê os custos. */
  seesCosts(role: Role | undefined) {
    return this.permissions.canWrite(role, "catalog");
  }

  private reservationsApply() {
    return this.modules.isEnabled("stock") && this.modules.isEnabled("encomendas");
  }

  // ---- Vistas ----

  private lineView(line: LineRow, seesCosts: boolean) {
    const { product, unitCost, lineTotal, ...rest } = line;
    const quantity = Number(line.quantity);
    const received = Number(line.receivedQuantity);
    return {
      ...rest,
      quantity,
      receivedQuantity: received,
      remainingQuantity: round2(quantity - received),
      ...(seesCosts ? { unitCost: Number(unitCost), lineTotal: Number(lineTotal) } : {}),
      product,
    };
  }

  private headView<T extends { number: number; total: Prisma.Decimal; expectedAt: Date | null }>(o: T, seesCosts: boolean) {
    const { total, ...rest } = o;
    return { ...rest, code: purchaseCode(o.number), expectedAt: day(o.expectedAt), ...(seesCosts ? { total: Number(total) } : {}) };
  }

  private async detailView(o: DetailRow, seesCosts: boolean) {
    const lines = o.lines.map((l) => this.lineView(l, seesCosts));
    const receipts = await this.prisma.stockMovement.findMany({
      where: { sourceType: PURCHASE_ORDER_SOURCE, sourceId: o.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, quantity: true, note: true, createdAt: true, product: { select: { id: true, sku: true, name: true } }, user: { select: { id: true, name: true } } },
    });
    return {
      ...this.headView(o, seesCosts),
      lines,
      partiallyReceived: o.status === "SENT" && lines.some((l) => l.receivedQuantity > 0),
      receipts: receipts.map((r) => ({ ...r, quantity: Number(r.quantity) })),
    };
  }

  async findPage(query: QueryPurchaseOrdersDto, role?: Role) {
    const where: Prisma.PurchaseOrderWhereInput = {};
    const term = query.search?.trim();
    if (term) {
      const folded = foldSearch(term);
      const number = /^(?:cf-?)?0*(\d{1,9})$/i.exec(term);
      where.OR = [...(number ? [{ number: Number(number[1]) }] : []), { searchText: { contains: folded } }, { supplier: { searchText: { contains: folded } } }];
    }
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.productId) where.lines = { some: { productId: query.productId } };
    const page = await readPage(LIST_KEY, query, (after, take) =>
      this.prisma.purchaseOrder.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(LIST_KEY), take, include: LIST }),
    );
    const sent = page.items.filter((o) => o.status === "SENT").map((o) => o.id);
    const partial = new Set<string>();
    if (sent.length) {
      const rows = await this.prisma.purchaseOrderLine.groupBy({ by: ["purchaseOrderId"], where: { purchaseOrderId: { in: sent }, receivedQuantity: { gt: 0 } }, _count: { _all: true } });
      for (const r of rows) partial.add(r.purchaseOrderId);
    }
    const seesCosts = this.seesCosts(role);
    return {
      ...page,
      items: page.items.map((o: ListRow) => {
        const { _count, ...rest } = o;
        return { ...this.headView(rest, seesCosts), lineCount: _count.lines, partiallyReceived: partial.has(o.id) };
      }),
    };
  }

  async findOne(id: string, role?: Role) {
    return this.detailView(await this.load(id), this.seesCosts(role));
  }

  private async load(id: string, db: Db = this.prisma) {
    const purchase = await db.purchaseOrder.findUnique({ where: { id }, include: DETAIL });
    if (!purchase) throw new NotFoundException("Compra não encontrada");
    return purchase;
  }

  /** Bloqueia a compra até ao fim da transação e devolve o estado atual. */
  private async lock(tx: Tx, id: string) {
    const [row] = await tx.$queryRaw<Array<{ id: string; number: number; status: PurchaseOrderStatus; supplierId: string }>>`
      SELECT "id", "number", "status", "supplierId" FROM "PurchaseOrder" WHERE "id" = ${id} FOR UPDATE`;
    if (!row) throw new NotFoundException("Compra não encontrada");
    return row;
  }

  private note(db: Db, purchaseId: string, description: string, userId: string) {
    return db.timelineEvent.create({ data: { entityType: "PURCHASE_ORDER", entityId: purchaseId, type: "SYSTEM", description, userId, createdAt: monotonicNow() } });
  }

  private async assertSupplier(supplierId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: supplierId }, select: { isSupplier: true } });
    if (!company) throw new BadRequestException("Fornecedor não encontrado");
    if (!company.isSupplier) throw new BadRequestException("Essa empresa não está marcada como fornecedor");
  }

  async create(dto: CreatePurchaseOrderDto, userId: string, role?: Role) {
    await this.assertSupplier(dto.supplierId);
    const created = await lockedTransaction(this.prisma, async (tx) => {
      const purchase = await tx.purchaseOrder.create({
        data: {
          supplierId: dto.supplierId,
          supplierReference: dto.supplierReference?.trim() || null,
          expectedAt: dto.expectedAt ? new Date(`${dto.expectedAt}T00:00:00Z`) : null,
          notes: dto.notes?.trim() || null,
          createdById: userId,
        },
      });
      await this.note(tx, purchase.id, `Compra ${purchaseCode(purchase.number)} criada`, userId);
      return purchase;
    });
    return this.findOne(created.id, role);
  }

  async update(id: string, dto: UpdatePurchaseOrderDto, userId: string, role?: Role) {
    const existing = await this.load(id);
    if (!OPEN.includes(existing.status)) throw new ConflictException(`A compra está ${STATUS_LABEL[existing.status]}: já não se altera`);
    const supplierChanges = dto.supplierId !== undefined && dto.supplierId !== existing.supplierId;
    if (supplierChanges) {
      if (existing.status !== "DRAFT") throw new ConflictException("O fornecedor só se muda enquanto a compra é rascunho");
      await this.assertSupplier(dto.supplierId!);
    }
    const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
    await lockedTransaction(this.prisma, async (tx) => {
      const locked = await this.lock(tx, id);
      if (supplierChanges && locked.status !== "DRAFT") throw new ConflictException("O fornecedor só se muda enquanto a compra é rascunho");
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: supplierChanges ? dto.supplierId : undefined,
          supplierReference: text(dto.supplierReference),
          expectedAt: dto.expectedAt === undefined ? undefined : dto.expectedAt ? new Date(`${dto.expectedAt}T00:00:00Z`) : null,
          notes: text(dto.notes),
        },
      });
      if (supplierChanges) {
        const supplier = await tx.company.findUniqueOrThrow({ where: { id: dto.supplierId! }, select: { name: true } });
        await this.note(tx, id, `Fornecedor: ${supplier.name}`, userId);
      }
      if (dto.expectedAt !== undefined && (dto.expectedAt ?? null) !== day(existing.expectedAt)) {
        await this.note(tx, id, dto.expectedAt ? `Entrega prevista: ${dto.expectedAt.split("-").reverse().join("/")}` : "Sem data prevista de entrega", userId);
      }
    });
    return this.findOne(id, role);
  }

  async remove(id: string) {
    await lockedTransaction(this.prisma, async (tx) => {
      const locked = await this.lock(tx, id);
      if (locked.status !== "DRAFT") throw new ConflictException("Só se apagam rascunhos: cancela a compra");
      await tx.purchaseOrder.delete({ where: { id } });
    });
  }

  // ---- Linhas (só em rascunho) ----

  private async refreshTotal(tx: Tx, purchaseId: string) {
    const sum = await tx.purchaseOrderLine.aggregate({ where: { purchaseOrderId: purchaseId }, _sum: { lineTotal: true } });
    await tx.purchaseOrder.update({ where: { id: purchaseId }, data: { total: sum._sum.lineTotal ?? 0 } });
  }

  private async draftLock(tx: Tx, purchaseId: string) {
    const purchase = await this.lock(tx, purchaseId);
    if (purchase.status !== "DRAFT") throw new ConflictException("As linhas só se alteram enquanto a compra é rascunho");
    return purchase;
  }

  private assertCostAllowed(unitCost: number | undefined, role: Role | undefined) {
    if (unitCost !== undefined && !this.seesCosts(role)) throw new ForbiddenException("Só quem vê os preços de custo (área «Catálogo de produtos») os pode indicar");
  }

  /** Acrescenta (ou soma, se o produto já lá estiver e `merge`) uma linha a um rascunho bloqueado. Custo do catálogo. */
  private async putLine(tx: Tx, purchase: { id: string; supplierId: string }, productId: string, quantity: number, unitCost: number | undefined, merge: boolean) {
    const existing = await tx.purchaseOrderLine.findUnique({ where: { purchaseOrderId_productId: { purchaseOrderId: purchase.id, productId } } });
    if (existing) {
      if (!merge) throw new ConflictException("Esse produto já está nesta compra: altera a quantidade da linha");
      const nextQty = round2(Number(existing.quantity) + quantity);
      return tx.purchaseOrderLine.update({ where: { id: existing.id }, data: { quantity: nextQty, lineTotal: purchaseLineTotal(nextQty, existing.unitCost) } });
    }
    const count = await tx.purchaseOrderLine.count({ where: { purchaseOrderId: purchase.id } });
    if (count >= MAX_LINES_PER_PURCHASE) throw new BadRequestException(`Uma compra tem no máximo ${MAX_LINES_PER_PURCHASE} linhas`);
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { sku: true, name: true, suppliers: { where: { companyId: purchase.supplierId }, select: { supplierSku: true, costPrice: true } } },
    });
    const link = product.suppliers[0];
    const cost = unitCost ?? (link?.costPrice != null ? Number(link.costPrice) : 0);
    const last = await tx.purchaseOrderLine.aggregate({ where: { purchaseOrderId: purchase.id }, _max: { position: true } });
    return tx.purchaseOrderLine.create({
      data: {
        purchaseOrderId: purchase.id,
        position: (last._max.position ?? -1) + 1,
        productId,
        sku: product.sku,
        description: product.name,
        supplierSku: link?.supplierSku ?? null,
        quantity,
        unitCost: cost,
        lineTotal: purchaseLineTotal(quantity, cost),
      },
    });
  }

  async addLine(purchaseId: string, dto: CreatePurchaseLineDto, userId: string, role?: Role) {
    this.assertCostAllowed(dto.unitCost, role);
    await lockedTransaction(this.prisma, async (tx) => {
      const purchase = await this.draftLock(tx, purchaseId);
      const product = await tx.product.findUnique({ where: { id: dto.productId }, select: { active: true } });
      if (!product) throw new BadRequestException("Produto não encontrado");
      if (!product.active) throw new BadRequestException("Esse produto está desativado");
      const line = await this.putLine(tx, purchase, dto.productId, dto.quantity, dto.unitCost, false);
      await this.refreshTotal(tx, purchaseId);
      await this.note(tx, purchaseId, `Linha acrescentada: ${reservationText(Number(line.quantity), line)}`, userId);
    });
    return this.findOne(purchaseId, role);
  }

  async updateLine(purchaseId: string, lineId: string, dto: UpdatePurchaseLineDto, userId: string, role?: Role) {
    this.assertCostAllowed(dto.unitCost, role);
    await lockedTransaction(this.prisma, async (tx) => {
      await this.draftLock(tx, purchaseId);
      const existing = await tx.purchaseOrderLine.findFirst({ where: { id: lineId, purchaseOrderId: purchaseId } });
      if (!existing) throw new NotFoundException("Linha não encontrada");
      const quantity = dto.quantity ?? existing.quantity;
      const unitCost = dto.unitCost ?? existing.unitCost;
      const line = await tx.purchaseOrderLine.update({ where: { id: lineId }, data: { quantity, unitCost, lineTotal: purchaseLineTotal(quantity, unitCost) } });
      await this.refreshTotal(tx, purchaseId);
      // Só a quantidade vai para a timeline (os custos não são para todos).
      if (!existing.quantity.equals(line.quantity)) {
        await this.note(tx, purchaseId, `Linha alterada: ${reservationText(Number(existing.quantity), existing)} → ${reservationText(Number(line.quantity), line)}`, userId);
      }
    });
    return this.findOne(purchaseId, role);
  }

  async removeLine(purchaseId: string, lineId: string, userId: string, role?: Role) {
    await lockedTransaction(this.prisma, async (tx) => {
      await this.draftLock(tx, purchaseId);
      const existing = await tx.purchaseOrderLine.findFirst({ where: { id: lineId, purchaseOrderId: purchaseId } });
      if (!existing) throw new NotFoundException("Linha não encontrada");
      await tx.purchaseOrderLine.delete({ where: { id: lineId } });
      await this.refreshTotal(tx, purchaseId);
      await this.note(tx, purchaseId, `Linha retirada: ${reservationText(Number(existing.quantity), existing)}`, userId);
    });
    return this.findOne(purchaseId, role);
  }

  // ---- Estados ----

  async send(id: string, userId: string, role?: Role) {
    await lockedTransaction(this.prisma, async (tx) => {
      const purchase = await this.lock(tx, id);
      if (purchase.status !== "DRAFT") throw new ConflictException(`A compra está ${STATUS_LABEL[purchase.status]}: não pode passar a enviada`);
      if ((await tx.purchaseOrderLine.count({ where: { purchaseOrderId: id } })) === 0) throw new BadRequestException("Acrescenta pelo menos uma linha antes de enviar");
      await tx.purchaseOrder.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
      await this.note(tx, id, "Compra enviada ao fornecedor", userId);
    });
    return this.findOne(id, role);
  }

  /**
   * Receção (também em parte): por linha, até ao que falta. Lança as entradas `PURCHASE_IN` (produtos que controlam
   * stock) e dá o que entrou às encomendas à espera; com tudo recebido, a compra fica recebida.
   */
  async receive(id: string, dto: ReceivePurchaseDto, userId: string, role?: Role) {
    const lineIds = dto.lines.map((l) => l.lineId);
    if (new Set(lineIds).size !== lineIds.length) throw new BadRequestException("Cada linha aparece uma vez na receção");
    const note = dto.note?.trim() || null;
    const served = await lockedTransaction(this.prisma, async (tx) => {
      const purchase = await this.lock(tx, id);
      if (purchase.status !== "SENT") throw new ConflictException(`A compra está ${STATUS_LABEL[purchase.status]}: só as compras enviadas recebem`);
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id, id: { in: lineIds } }, orderBy: LINE_ORDER });
      if (lines.length !== lineIds.length) throw new BadRequestException("Linha não encontrada nesta compra");
      const products = await lockProducts(tx, lines.map((l) => l.productId));
      const quantities = new Map(dto.lines.map((l) => [l.lineId, l.quantity]));
      const code = purchaseCode(purchase.number);
      const items: string[] = [];
      for (const line of lines) {
        const quantity = quantities.get(line.id)!;
        const remaining = round2(Number(line.quantity) - Number(line.receivedQuantity));
        if (quantity > remaining) {
          throw new BadRequestException(`Recebido a mais: só falta ${reservationText(remaining, line)}. O excesso entra como movimento de stock`);
        }
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQuantity: { increment: quantity } } });
        if (products.get(line.productId)?.tracksStock) {
          await recordMovement(tx, { productId: line.productId, type: "PURCHASE_IN", quantity, reason: `${code}: receção`, note, sourceType: PURCHASE_ORDER_SOURCE, sourceId: id, userId });
        }
        items.push(reservationText(quantity, line));
      }
      await this.note(tx, id, `Receção: ${items.join("; ")}${note ? ` — ${note}` : ""}`, userId);
      const missing = await tx.purchaseOrderLine.count({ where: { purchaseOrderId: id, receivedQuantity: { lt: this.prisma.purchaseOrderLine.fields.quantity } } });
      if (missing === 0) {
        await tx.purchaseOrder.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date() } });
        await this.note(tx, id, "Compra recebida por completo", userId);
      }
      const served = new Set<string>();
      if (this.reservationsApply()) {
        for (const product of [...products.values()].filter((p) => p.tracksStock)) {
          for (const orderId of (await allocateWaiting(tx, product.id, userId)).keys()) served.add(orderId);
        }
      }
      return served;
    });
    await this.preparation.afterAllocation(served, userId);
    return this.findOne(id, role);
  }

  /** Fechar com falta: o resto já não vem (deixa de contar como «em compra»). Só depois de alguma receção. */
  async close(id: string, dto: ClosePurchaseDto, userId: string, role?: Role) {
    const reason = dto.reason.trim();
    await lockedTransaction(this.prisma, async (tx) => {
      const purchase = await this.lock(tx, id);
      if (purchase.status !== "SENT") throw new ConflictException(`A compra está ${STATUS_LABEL[purchase.status]}: só se fecham compras enviadas`);
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id }, orderBy: LINE_ORDER });
      if (!lines.some((l) => Number(l.receivedQuantity) > 0)) throw new ConflictException("Ainda não se recebeu nada: cancela a compra");
      const missing = lines.filter((l) => Number(l.receivedQuantity) < Number(l.quantity));
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date(), closeReason: reason } });
      await this.note(tx, id, `Compra fechada com falta: ${reason} (não vem: ${missing.map((l) => reservationText(round2(Number(l.quantity) - Number(l.receivedQuantity)), l)).join("; ")})`, userId);
    });
    return this.findOne(id, role);
  }

  async cancel(id: string, dto: ClosePurchaseDto, userId: string, role?: Role) {
    const reason = dto.reason.trim();
    await lockedTransaction(this.prisma, async (tx) => {
      const purchase = await this.lock(tx, id);
      if (!OPEN.includes(purchase.status)) throw new ConflictException(`A compra está ${STATUS_LABEL[purchase.status]}: já não se cancela`);
      if ((await tx.purchaseOrderLine.count({ where: { purchaseOrderId: id, receivedQuantity: { gt: 0 } } })) > 0) {
        throw new ConflictException("A compra já tem receções: fecha-a com falta em vez de a cancelar");
      }
      await tx.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), closeReason: reason } });
      await this.note(tx, id, `Compra cancelada: ${reason}`, userId);
    });
    return this.findOne(id, role);
  }

  // ---- Sugestões a partir das encomendas ----

  private assertOrdersOn() {
    if (!this.modules.isEnabled("encomendas")) throw new BadRequestException("O módulo «Encomendas» está desligado: não há encomendas à espera");
  }

  /** Fornecedor de cada produto para as sugestões: o preferido, senão o único. */
  private async suppliersFor(productIds: string[]) {
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        sku: true,
        name: true,
        suppliers: { select: { companyId: true, preferredFor: true, costPrice: true, company: { select: { id: true, name: true } } } },
      },
    });
    return new Map(
      products.map((p) => {
        const chosen = p.suppliers.find((s) => s.preferredFor) ?? (p.suppliers.length === 1 ? p.suppliers[0] : null);
        return [p.id, { product: { id: p.id, sku: p.sku, name: p.name }, supplier: chosen?.company ?? null, unitCost: chosen?.costPrice != null ? Number(chosen.costPrice) : null, supplierCount: p.suppliers.length }];
      }),
    );
  }

  async suggestions(role?: Role) {
    this.assertOrdersOn();
    const needs = await computeNeeds(this.prisma);
    const info = await this.suppliersFor(needs.map((n) => n.productId));
    const seesCosts = this.seesCosts(role);
    const items = needs.map((n) => {
      const i = info.get(n.productId)!;
      return {
        product: i.product,
        waiting: n.waiting,
        overReserved: n.overReserved,
        onOrder: n.onOrder,
        need: n.need,
        supplier: i.supplier,
        supplierCount: i.supplierCount,
        ...(seesCosts ? { unitCost: i.unitCost } : {}),
        orders: n.orders.map((o) => ({ id: o.id, code: orderCode(o.number) })),
      };
    });
    items.sort((a, b) => (a.supplier?.name ?? "￿").localeCompare(b.supplier?.name ?? "￿", "pt") || a.product.sku.localeCompare(b.product.sku));
    return { items };
  }

  /**
   * «Criar compras»: volta a calcular com os produtos bloqueados e junta as linhas ao rascunho mais recente de cada
   * fornecedor (ou cria um). Bloqueios na ordem de sempre: compras → produtos.
   */
  async generate(dto: GeneratePurchasesDto, userId: string) {
    this.assertOrdersOn();
    const productIds = [...new Set(dto.productIds)].sort();
    const info = await this.suppliersFor(productIds);
    const supplierIds = [...new Set([...info.values()].map((i) => i.supplier?.id).filter((id): id is string => !!id))].sort();
    return lockedTransaction(this.prisma, async (tx) => {
      const drafts = new Map<string, { id: string; number: number; supplierId: string; created: boolean }>();
      for (const supplierId of supplierIds) {
        const [draft] = await tx.$queryRaw<Array<{ id: string; number: number }>>`
          SELECT "id", "number" FROM "PurchaseOrder" WHERE "supplierId" = ${supplierId} AND "status" = 'DRAFT'
          ORDER BY "createdAt" DESC, "id" DESC LIMIT 1 FOR UPDATE`;
        if (draft) drafts.set(supplierId, { ...draft, supplierId, created: false });
      }
      await lockProducts(tx, productIds);
      const needs = new Map((await computeNeeds(tx, productIds)).map((n) => [n.productId, n]));
      const skipped: Array<{ product: { id: string; sku: string; name: string }; reason: string }> = [];
      const touched = new Map<string, { items: string[]; orders: Set<string> }>();
      if (productIds.some((id) => !info.has(id))) throw new BadRequestException("Produto não encontrado");
      // Bloqueados por id; tratados pela referência (as linhas e as notas ficam por uma ordem que se lê).
      const bySku = [...productIds].sort((a, b) => info.get(a)!.product.sku.localeCompare(info.get(b)!.product.sku));
      for (const productId of bySku) {
        const i = info.get(productId)!;
        const need = needs.get(productId);
        if (!need) {
          skipped.push({ product: i.product, reason: "Já está coberto (nada a comprar)" });
          continue;
        }
        if (!i.supplier) {
          skipped.push({ product: i.product, reason: i.supplierCount ? "Tem vários fornecedores e nenhum preferido" : "Não tem fornecedor" });
          continue;
        }
        let draft = drafts.get(i.supplier.id);
        if (!draft) {
          const created = await tx.purchaseOrder.create({ data: { supplierId: i.supplier.id, createdById: userId } });
          draft = { id: created.id, number: created.number, supplierId: i.supplier.id, created: true };
          drafts.set(i.supplier.id, draft);
          await this.note(tx, created.id, `Compra ${purchaseCode(created.number)} criada a partir das encomendas à espera`, userId);
        }
        await this.putLine(tx, draft, productId, need.need, undefined, true);
        const t = touched.get(draft.id) ?? { items: [], orders: new Set<string>() };
        t.items.push(reservationText(need.need, { description: i.product.name, sku: i.product.sku }));
        for (const o of need.orders) t.orders.add(orderCode(o.number));
        touched.set(draft.id, t);
      }
      const purchases: Array<{ id: string; code: string; supplier: { id: string; name: string }; created: boolean }> = [];
      for (const draft of drafts.values()) {
        const t = touched.get(draft.id);
        if (!t) continue;
        await this.refreshTotal(tx, draft.id);
        await this.note(tx, draft.id, `Para as encomendas à espera (${[...t.orders].sort().join(", ")}): ${t.items.join("; ")}`, userId);
        const supplier = [...info.values()].find((i) => i.supplier?.id === draft.supplierId)!.supplier!;
        purchases.push({ id: draft.id, code: purchaseCode(draft.number), supplier, created: draft.created });
      }
      return { purchases, skipped };
    });
  }
}
