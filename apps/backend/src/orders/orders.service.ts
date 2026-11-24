import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, SalesOrderStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { foldSearch } from "../common/search-text";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import { lockedTransaction } from "../common/locked-transaction";
import { CancelOrderDto, CreateOrderDto, CreateOrderLineDto, QueryOrdersDto, UpdateOrderDto, UpdateOrderLineDto } from "./dto/order.dto";

/** No máximo isto por encomenda: as linhas vêm sempre todas com a encomenda. */
export const MAX_LINES_PER_ORDER = 200;

export const orderCode = (n: number) => `EN-${String(n).padStart(4, "0")}`;

const D = Prisma.Decimal;
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
const NEXT: Record<"confirm" | "ship" | "deliver", { from: SalesOrderStatus; to: SalesOrderStatus; stamp: "confirmedAt" | "shippedAt" | "deliveredAt"; label: string }> = {
  confirm: { from: "DRAFT", to: "CONFIRMED", stamp: "confirmedAt", label: "Encomenda confirmada" },
  ship: { from: "CONFIRMED", to: "SHIPPED", stamp: "shippedAt", label: "Encomenda enviada" },
  deliver: { from: "SHIPPED", to: "DELIVERED", stamp: "deliveredAt", label: "Encomenda entregue" },
};

const STATUS_LABEL: Record<SalesOrderStatus, string> = {
  DRAFT: "rascunho",
  CONFIRMED: "confirmada",
  SHIPPED: "enviada",
  DELIVERED: "entregue",
  CANCELLED: "cancelada",
};

const PARTY = {
  company: { select: { id: true, name: true, taxId: true } },
  contact: { select: { id: true, name: true, email: true } },
  assignee: { select: { id: true, name: true } },
} as const;
const LINE_ORDER: Prisma.SalesOrderLineOrderByWithRelationInput[] = [{ position: "asc" }, { id: "asc" }];
const DETAIL = { ...PARTY, createdBy: { select: { id: true, name: true } }, lines: { orderBy: LINE_ORDER } } satisfies Prisma.SalesOrderInclude;
const LIST = { ...PARTY, _count: { select: { lines: true } } } as const;

type DetailRow = Prisma.SalesOrderGetPayload<{ include: typeof DETAIL }>;
type ListRow = Prisma.SalesOrderGetPayload<{ include: typeof LIST }>;
type LineRow = DetailRow["lines"][number];
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
  ) {}

  private lineView(line: LineRow) {
    const { vat } = computeLine(line);
    return {
      ...line,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      discountPct: Number(line.discountPct),
      vatRate: Number(line.vatRate),
      lineTotal: Number(line.lineTotal),
      vatAmount: Number(vat),
    };
  }

  private money<T extends { subtotal: Prisma.Decimal; vatTotal: Prisma.Decimal; total: Prisma.Decimal; number: number }>(o: T) {
    return { ...o, code: orderCode(o.number), subtotal: Number(o.subtotal), vatTotal: Number(o.vatTotal), total: Number(o.total) };
  }

  private detailView(o: DetailRow) {
    return { ...this.money(o), lines: o.lines.map((l) => this.lineView(l)) };
  }

  private listView(o: ListRow) {
    const { _count, ...rest } = o;
    return { ...this.money(rest), lineCount: _count.lines };
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
    const page = await readPage(LIST_KEY, query, (after, take) =>
      this.prisma.salesOrder.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(LIST_KEY), take, include: LIST }),
    );
    return { ...page, items: page.items.map((o) => this.listView(o)) };
  }

  async findOne(id: string) {
    return this.detailView(await this.load(id));
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
    return tx.timelineEvent.create({ data: { entityType: "ORDER", entityId: orderId, type: "SYSTEM", description, userId } });
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
    return this.findOne(order.id);
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
    // Os valores dos campos personalizados não têm chave estrangeira (polimórficos): apagam-se juntamente.
    await this.prisma.$transaction([
      this.prisma.customFieldValue.deleteMany({ where: { entityType: "ORDER", entityId: id } }),
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

  async advance(id: string, step: keyof typeof NEXT, userId: string) {
    const t = NEXT[step];
    await lockedTransaction(this.prisma, async (tx) => {
      const order = await this.lock(tx, id);
      if (order.status !== t.from) {
        throw new ConflictException(`A encomenda está ${STATUS_LABEL[order.status]}: não pode passar a ${STATUS_LABEL[t.to]}`);
      }
      if (step === "confirm") {
        const full = await tx.salesOrder.findUniqueOrThrow({ where: { id }, select: { companyId: true, contactId: true, _count: { select: { lines: true } } } });
        if (full._count.lines === 0) throw new BadRequestException("Acrescenta pelo menos uma linha antes de confirmar");
        if (!full.companyId && !full.contactId) throw new BadRequestException("Indica o cliente antes de confirmar");
      }
      await tx.salesOrder.update({ where: { id }, data: { status: t.to, [t.stamp]: new Date() } });
      await this.note(tx, id, t.label, userId);
    });
    return this.findOne(id);
  }

  async cancel(id: string, dto: CancelOrderDto, userId: string) {
    const reason = dto.reason.trim();
    await lockedTransaction(this.prisma, async (tx) => {
      const order = await this.lock(tx, id);
      if (order.status !== "DRAFT" && order.status !== "CONFIRMED") {
        throw new ConflictException(`A encomenda está ${STATUS_LABEL[order.status]}: já não se cancela`);
      }
      await tx.salesOrder.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
      await this.note(tx, id, `Encomenda cancelada: ${reason}`, userId);
    });
    return this.findOne(id);
  }
}

/** «2 × Toner (TN-2420) a 45,90 € −10%»: para a timeline. */
export function lineText(line: { quantity: Prisma.Decimal | number; description: string; sku: string | null; unitPrice: Prisma.Decimal | number; discountPct: Prisma.Decimal | number }) {
  const pt = (n: number, digits = 2) => n.toLocaleString("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: digits });
  const discount = Number(line.discountPct);
  return `${pt(Number(line.quantity))} × ${line.description}${line.sku ? ` (${line.sku})` : ""} a ${Number(line.unitPrice).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €${discount ? ` −${pt(discount)}%` : ""}`;
}
