import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, StockMovementType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import { CreateStockMovementDto, QueryStockMovementsDto } from "./dto/stock.dto";

const INCLUDE = {
  product: { select: { id: true, sku: true, name: true } },
  user: { select: { id: true, name: true } },
} as const;

/** Mais recentes primeiro. */
const LIST_KEY: KeyField[] = [
  { field: "createdAt", dir: "desc", kind: "date" },
  { field: "id", dir: "desc", kind: "string" },
];

type Tx = Prisma.TransactionClient;

/** Arredonda a 2 casas (as quantidades são DECIMAL(12,2)). */
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Lança um movimento de stock numa transação, com a linha do produto bloqueada (dois acertos ao mesmo tempo não se
 * pisam). Devolve o movimento. Usado pelos movimentos manuais e, na 5c, pelas peças das assistências.
 */
export async function recordMovement(
  tx: Tx,
  input: { productId: string; type: StockMovementType; quantity: number; reason?: string | null; note?: string | null; sourceType?: string | null; sourceId?: string | null; userId: string },
) {
  return tx.stockMovement.create({
    data: {
      productId: input.productId,
      type: input.type,
      quantity: round2(input.quantity),
      reason: input.reason ?? null,
      note: input.note ?? null,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      userId: input.userId,
    },
    include: INCLUDE,
  });
}

/** Bloqueia a linha do produto até ao fim da transação e devolve o que interessa ao stock. */
export async function lockProduct(tx: Tx, productId: string) {
  const [row] = await tx.$queryRaw<Array<{ id: string; tracksStock: boolean; stockOnHand: Prisma.Decimal }>>`
    SELECT "id", "tracksStock", "stockOnHand" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
  return row ?? null;
}

/**
 * Stock (Fase 5b, docs/plano-fase-5-produtos-stock.md): livro de movimentos só de acrescentar. O stock atual é a
 * soma (Product.stockOnHand, por trigger); pode ficar negativo (a faturação manda no stock).
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  private view<T extends { quantity: Prisma.Decimal }>(m: T) {
    return { ...m, quantity: Number(m.quantity) };
  }

  async create(dto: CreateStockMovementDto, userId: string) {
    const reason = dto.reason?.trim() || null;
    const note = dto.note?.trim() || null;
    const movement = await this.withLock(async (tx) => {
      const product = await lockProduct(tx, dto.productId);
      if (!product) throw new NotFoundException("Produto não encontrado");
      if (!product.tracksStock) throw new BadRequestException("Este produto não controla stock");
      const current = Number(product.stockOnHand);

      if (dto.type === "ADJUSTMENT") {
        if (dto.countedQuantity === undefined) throw new BadRequestException("Indica a quantidade contada");
        if (!reason) throw new BadRequestException("Indica o motivo do acerto");
        const delta = round2(dto.countedQuantity - current);
        if (delta === 0) throw new BadRequestException(`O stock já é ${current.toLocaleString("pt-PT")}`);
        return recordMovement(tx, { productId: dto.productId, type: "ADJUSTMENT", quantity: delta, reason, note, userId });
      }

      if (dto.quantity === undefined) throw new BadRequestException("Indica a quantidade");
      if (dto.type === "INITIAL" && (await tx.stockMovement.count({ where: { productId: dto.productId } })) > 0) {
        throw new ConflictException("O stock inicial só se lança antes de qualquer outro movimento: usa um acerto de contagem");
      }
      const quantity = dto.type === "SALE_OUT" ? -dto.quantity : dto.quantity;
      return recordMovement(tx, { productId: dto.productId, type: dto.type, quantity, reason, note, userId });
    });
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: dto.productId }, select: { stockOnHand: true, belowMin: true } });
    return { movement: this.view(movement), stockOnHand: Number(product.stockOnHand), belowMin: product.belowMin };
  }

  /**
   * Transação com a linha do produto bloqueada. Pedidos simultâneos no mesmo produto esperam em fila; o tempo de
   * espera do Prisma (2 s por omissão) é alargado, e se mesmo assim se esgotar, responde 409 em vez de 500.
   */
  async withLock<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn, { maxWait: 15_000, timeout: 15_000 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
        throw new ConflictException("Há muitos movimentos a ser lançados ao mesmo tempo: tenta de novo");
      }
      throw err;
    }
  }

  async findPage(query: QueryStockMovementsDto) {
    const where: Prisma.StockMovementWhereInput = {};
    if (query.productId) where.productId = query.productId;
    if (query.type) where.type = query.type;
    if (query.from || query.to) where.createdAt = { gte: query.from ? new Date(query.from) : undefined, lt: query.to ? new Date(query.to) : undefined };
    const page = await readPage(LIST_KEY, query, (after, take) =>
      this.prisma.stockMovement.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(LIST_KEY), take, include: INCLUDE }),
    );
    return { ...page, items: page.items.map((m) => this.view(m)) };
  }

  /** Alertas: produtos ativos que controlam stock abaixo do mínimo e com stock negativo. */
  async summary() {
    const base = { active: true, tracksStock: true };
    const [belowMin, negative] = await Promise.all([
      this.prisma.product.count({ where: { ...base, belowMin: true } }),
      this.prisma.product.count({ where: { ...base, stockOnHand: { lt: 0 } } }),
    ]);
    return { belowMin, negative };
  }
}
