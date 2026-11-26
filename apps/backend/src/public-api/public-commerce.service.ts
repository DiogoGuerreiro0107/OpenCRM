import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { OrdersService } from "../orders/orders.service";
import { DuplicateExternalIdError, OrderIntakeError } from "../orders/order-intake";
import { decodeCursor, encodeCursor } from "../common/cursor";
import { AuthenticatedApiKey } from "./api-key.guard";
import { apiKeyProvider } from "./external-provider";
import { PUBLIC_ORDER_INCLUDE, PUBLIC_PRODUCT_INCLUDE, publicOrder, publicProduct } from "./mappers";
import { ApiError } from "./v1-error.filter";
import { V1CreateOrderDto, V1ListOrdersQueryDto, V1ListProductsQueryDto } from "./dto/v1-orders.dto";
import { V1ListQueryDto } from "./dto/v1-list-query.dto";

const DEFAULT_LIMIT = 50;

/** O mesmo filtro de sincronização das empresas e contactos: (updatedAt, id) crescente, `updated_since` + cursor. */
function syncWindow(query: V1ListQueryDto) {
  const and: Array<Record<string, unknown>> = [];
  if (query.updated_since) and.push({ updatedAt: { gte: new Date(query.updated_since) } });
  const cursor = decodeCursor(query.cursor);
  if (cursor) and.push({ OR: [{ updatedAt: { gt: cursor.createdAt } }, { updatedAt: cursor.createdAt, id: { gt: cursor.id } }] });
  return and;
}

function nextCursor<T extends { id: string; updatedAt: Date }>(rows: T[], limit: number) {
  const last = rows.slice(0, limit).at(-1);
  return rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null;
}

/**
 * Produtos e encomendas na API pública (Fase 6e, docs/plano-fase-6-encomendas.md «Pacote 6e»). A criação de
 * encomendas faz o mesmo que a interface (OrdersService.createFromIntake); aqui só se traduz o contrato da v1.
 */
@Injectable()
export class PublicCommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly orders: OrdersService,
  ) {}

  private withStock() {
    return this.modules.isEnabled("stock");
  }

  async listProducts(query: V1ListProductsQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const and = syncWindow(query) as Prisma.ProductWhereInput[];
    const sku = query.sku?.trim();
    if (sku) and.push({ sku: { equals: sku, mode: "insensitive" } });
    const rows = await this.prisma.product.findMany({
      where: { AND: and },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      include: PUBLIC_PRODUCT_INCLUDE,
    });
    const withStock = this.withStock();
    return { data: rows.slice(0, limit).map((p) => publicProduct(p, withStock)), next_cursor: nextCursor(rows, limit) };
  }

  async getProduct(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: PUBLIC_PRODUCT_INCLUDE });
    if (!product) throw new NotFoundException("Produto não encontrado");
    return { data: publicProduct(product, this.withStock()) };
  }

  /** Os ids externos que ESTA chave deu às encomendas. */
  private async externalIds(apiKey: AuthenticatedApiKey, orderIds: string[]) {
    if (!orderIds.length) return new Map<string, string>();
    const links = await this.prisma.externalLink.findMany({
      where: { provider: apiKeyProvider(apiKey.id), entityType: "order", entityId: { in: orderIds } },
      select: { entityId: true, externalId: true },
    });
    return new Map(links.map((l) => [l.entityId, l.externalId]));
  }

  async listOrders(query: V1ListOrdersQueryDto, apiKey: AuthenticatedApiKey) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const and = syncWindow(query) as Prisma.SalesOrderWhereInput[];
    if (query.external_id !== undefined) {
      const link = await this.prisma.externalLink.findUnique({
        where: { provider_entityType_externalId: { provider: apiKeyProvider(apiKey.id), entityType: "order", externalId: query.external_id } },
        select: { entityId: true },
      });
      if (!link) return { data: [], next_cursor: null };
      and.push({ id: link.entityId });
    }
    const rows = await this.prisma.salesOrder.findMany({
      where: { AND: and },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      include: PUBLIC_ORDER_INCLUDE,
    });
    const items = rows.slice(0, limit);
    const external = await this.externalIds(apiKey, items.map((o) => o.id));
    return { data: items.map((o) => publicOrder(o, external.get(o.id) ?? null)), next_cursor: nextCursor(rows, limit) };
  }

  async getOrder(id: string, apiKey: AuthenticatedApiKey) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id }, include: PUBLIC_ORDER_INCLUDE });
    if (!order) throw new NotFoundException("Encomenda não encontrada");
    const external = await this.externalIds(apiKey, [id]);
    return { data: publicOrder(order, external.get(id) ?? null) };
  }

  /**
   * Cria a encomenda (e, se for preciso, a empresa e o contacto) numa só transação. Fica criada por quem criou a
   * chave, porque uma chave não é uma pessoa. Um `external_id` já usado por esta chave → 409 com a encomenda
   * existente, mesmo fora da janela de 24 h da idempotência.
   */
  async createOrder(dto: V1CreateOrderDto, apiKey: AuthenticatedApiKey) {
    const id = randomUUID();
    const provider = apiKeyProvider(apiKey.id);
    try {
      await this.orders.createFromIntake(
        {
          id,
          customer: {
            taxId: dto.customer.tax_id,
            email: dto.customer.email,
            companyName: dto.customer.company_name,
            name: dto.customer.name,
            phone: dto.customer.phone,
          },
          lines: dto.lines.map((l) => ({
            sku: l.sku,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unit_price,
            discountPct: l.discount_pct,
            vatRate: l.vat_rate,
          })),
          customerReference: dto.customer_reference,
          deliveryAddress: dto.delivery_address,
          notes: dto.notes,
          confirm: dto.confirm ?? false,
          origin: `API (chave «${apiKey.name}»)`,
          externalLink: dto.external_id ? { provider, externalId: dto.external_id } : undefined,
        },
        apiKey.createdById,
      );
    } catch (err) {
      if (err instanceof DuplicateExternalIdError) {
        const existing = await this.prisma.externalLink.findUnique({
          where: { provider_entityType_externalId: { provider, entityType: "order", externalId: dto.external_id! } },
          select: { entityId: true },
        });
        throw new ApiError(HttpStatus.CONFLICT, "conflict", "Já existe uma encomenda com este external_id", { existing_id: existing?.entityId ?? null });
      }
      if (err instanceof OrderIntakeError) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "unprocessable", err.message, err.details);
      throw err;
    }
    return this.getOrder(id, apiKey);
  }
}
