import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { lockProduct, recordMovement, StockService } from "../stock/stock.service";
import { allocateWaiting } from "../stock/reservations";
import { CreateServicePartDto, UpdateServicePartDto } from "./dto/service-part.dto";
import { serviceCode } from "./service-cases.service";

/** No máximo isto por assistência: a lista vem sempre inteira. */
export const MAX_PARTS_PER_CASE = 100;

/** Origem dos movimentos de stock lançados pelas peças (Fase 5c). */
export const SERVICE_CASE_SOURCE = "SERVICE_CASE";

const INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  product: { select: { id: true, sku: true, name: true, tracksStock: true, stockOnHand: true } },
} as const;

type PartRow = Prisma.ServicePartGetPayload<{ include: typeof INCLUDE }>;
type Tx = Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** «2 × Rolo de alimentação (RM2-5452)»; quantidades à portuguesa (1,5). */
export function partText(part: { quantity: Prisma.Decimal | number; description: string; reference: string | null }) {
  const quantity = Number(part.quantity).toLocaleString("pt-PT", { maximumFractionDigits: 2 });
  return `${quantity} × ${part.description}${part.reference ? ` (${part.reference})` : ""}`;
}

/**
 * Quanto a peça passa a ter tirado do stock quando a quantidade muda de `before` para `after`: a diferença sai ou
 * volta, mas nunca volta mais do que a peça tirou (Fase 5c).
 */
export function nextStockTaken(taken: number, before: number, after: number) {
  return Math.max(0, round2(taken + after - before));
}

/**
 * Peças usadas numa assistência (Fase 4c; ligadas a produtos e ao stock na 5c, docs/plano-fase-5-produtos-stock.md).
 * Cada mudança fica na timeline da assistência. Sem dono: quem tem escrita corrige. Uma peça do catálogo, com o
 * módulo de stock ligado e o produto a controlar stock, gasta stock (e devolve ao retirar), na mesma transação.
 */
@Injectable()
export class ServicePartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly stock: StockService,
  ) {}

  private view(part: PartRow) {
    return {
      ...part,
      quantity: Number(part.quantity),
      stockTaken: Number(part.stockTaken),
      product: part.product ? { ...part.product, stockOnHand: Number(part.product.stockOnHand) } : null,
    };
  }

  private async loadCase(serviceCaseId: string) {
    const found = await this.prisma.serviceCase.findUnique({ where: { workItemId: serviceCaseId }, select: { workItemId: true, number: true } });
    if (!found) throw new NotFoundException("Assistência não encontrada");
    return found;
  }

  private note(tx: Tx, serviceCaseId: string, description: string, actorId: string) {
    return tx.timelineEvent.create({ data: { entityType: "TASK", entityId: serviceCaseId, type: "SYSTEM", description, userId: actorId } });
  }

  /** A peça mexe no stock: módulo de stock ligado e o produto (bloqueado nesta transação) a controlar stock. */
  private stockApplies(product: { tracksStock: boolean } | null) {
    return !!product && product.tracksStock && this.modules.isEnabled("stock");
  }

  /** Movimento do consumo (negativo = sai), com a origem na assistência. Zero não se lança. */
  private async move(tx: Tx, input: { productId: string; quantity: number; caseNumber: number; serviceCaseId: string; what: string; userId: string }) {
    if (round2(input.quantity) === 0) return;
    await recordMovement(tx, {
      productId: input.productId,
      type: "SERVICE_PART",
      quantity: input.quantity,
      reason: `${serviceCode(input.caseNumber)}: ${input.what}`,
      sourceType: SERVICE_CASE_SOURCE,
      sourceId: input.serviceCaseId,
      userId: input.userId,
    });
    // Stock devolvido vai para as encomendas que aguardam (Fase 6b).
    if (input.quantity > 0 && this.stock.reservationsApply()) await allocateWaiting(tx, input.productId, input.userId);
  }

  async list(serviceCaseId: string) {
    await this.loadCase(serviceCaseId);
    const parts = await this.prisma.servicePart.findMany({ where: { serviceCaseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: INCLUDE });
    return parts.map((p) => this.view(p));
  }

  async create(serviceCaseId: string, dto: CreateServicePartDto, actorId: string) {
    const serviceCase = await this.loadCase(serviceCaseId);
    if ((await this.prisma.servicePart.count({ where: { serviceCaseId } })) >= MAX_PARTS_PER_CASE) {
      throw new BadRequestException(`Uma assistência tem no máximo ${MAX_PARTS_PER_CASE} peças`);
    }
    const quantity = dto.quantity ?? 1;
    const part = await this.stock.withLock(async (tx) => {
      let product: { id: string; sku: string; name: string; tracksStock: boolean } | null = null;
      if (dto.productId) {
        if (!this.modules.isEnabled("produtos")) throw new BadRequestException("O módulo «Produtos» está desligado: descreve a peça à mão");
        const locked = await lockProduct(tx, dto.productId);
        const found = locked && (await tx.product.findUnique({ where: { id: dto.productId }, select: { id: true, sku: true, name: true, active: true, tracksStock: true } }));
        if (!found) throw new BadRequestException("Produto não encontrado");
        if (!found.active) throw new BadRequestException("Esse produto está desativado");
        product = found;
      }
      const description = dto.description?.trim() || product?.name;
      if (!description) throw new BadRequestException("Descreve a peça");
      const reference = dto.reference === undefined && product ? product.sku : dto.reference?.trim() || null;
      const takes = this.stockApplies(product);
      const created = await tx.servicePart.create({
        data: { serviceCaseId, description, reference, quantity, productId: product?.id ?? null, stockTaken: takes ? quantity : 0, createdById: actorId },
        include: INCLUDE,
      });
      if (takes) await this.move(tx, { productId: product!.id, quantity: -quantity, caseNumber: serviceCase.number, serviceCaseId, what: "peça adicionada", userId: actorId });
      await this.note(tx, serviceCaseId, `Peça usada: ${partText(created)}`, actorId);
      return created;
    });
    return this.view(await this.reload(part.id));
  }

  async update(serviceCaseId: string, partId: string, dto: UpdateServicePartDto, actorId: string) {
    const serviceCase = await this.loadCase(serviceCaseId);
    const found = await this.findPart(serviceCaseId, partId);
    await this.stock.withLock(async (tx) => {
      const product = found.productId ? await lockProduct(tx, found.productId) : null;
      const existing = await this.lockPart(tx, partId);
      const part = await tx.servicePart.update({
        where: { id: partId },
        data: {
          description: dto.description?.trim(),
          reference: dto.reference === undefined ? undefined : dto.reference?.trim() || null,
          quantity: dto.quantity,
        },
      });
      if (product && this.stockApplies(product)) {
        const taken = Number(existing.stockTaken);
        const nextTaken = nextStockTaken(taken, Number(existing.quantity), Number(part.quantity));
        if (nextTaken !== taken) {
          await tx.servicePart.update({ where: { id: partId }, data: { stockTaken: nextTaken } });
          await this.move(tx, { productId: product.id, quantity: taken - nextTaken, caseNumber: serviceCase.number, serviceCaseId, what: "quantidade da peça alterada", userId: actorId });
        }
      }
      const before = partText(existing);
      const after = partText(part);
      if (before !== after) await this.note(tx, serviceCaseId, `Peça alterada: ${before} → ${after}`, actorId);
    });
    return this.view(await this.reload(partId));
  }

  async remove(serviceCaseId: string, partId: string, actorId: string) {
    const serviceCase = await this.loadCase(serviceCaseId);
    const found = await this.findPart(serviceCaseId, partId);
    await this.stock.withLock(async (tx) => {
      const product = found.productId ? await lockProduct(tx, found.productId) : null;
      const existing = await this.lockPart(tx, partId);
      await tx.servicePart.delete({ where: { id: partId } });
      const taken = Number(existing.stockTaken);
      if (product && taken > 0 && this.stockApplies(product)) {
        await this.move(tx, { productId: product.id, quantity: taken, caseNumber: serviceCase.number, serviceCaseId, what: "peça retirada", userId: actorId });
      }
      await this.note(tx, serviceCaseId, `Peça retirada: ${partText(existing)}`, actorId);
    });
  }

  private reload(partId: string) {
    return this.prisma.servicePart.findUniqueOrThrow({ where: { id: partId }, include: INCLUDE });
  }

  /** Bloqueia a peça até ao fim da transação (duas alterações à mesma peça não se pisam) e relê-a. */
  private async lockPart(tx: Tx, partId: string) {
    await tx.$queryRaw`SELECT "id" FROM "ServicePart" WHERE "id" = ${partId} FOR UPDATE`;
    const part = await tx.servicePart.findUnique({ where: { id: partId } });
    if (!part) throw new NotFoundException("Peça não encontrada");
    return part;
  }

  private async findPart(serviceCaseId: string, partId: string) {
    const part = await this.prisma.servicePart.findFirst({ where: { id: partId, serviceCaseId } });
    if (!part) throw new NotFoundException("Peça não encontrada");
    return part;
  }
}
