import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PermissionsService } from "../auth/permissions.service";
import { foldSearch } from "../common/search-text";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import { AddProductSupplierDto, CreateProductDto, QueryProductsDto, UpdateProductDto, UpdateProductSupplierDto } from "./dto/product.dto";

/** Referência guardada em maiúsculas e sem espaços nas pontas: «abc-1» e «ABC-1» são a mesma. */
export const normalizeSku = (sku: string) => sku.trim().toUpperCase();

const SUPPLIERS = { include: { company: { select: { id: true, name: true } } }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] };
const INCLUDE = { category: { select: { id: true, name: true } }, suppliers: SUPPLIERS } as const;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof INCLUDE }>;

/** Alfabética (nome, id). */
const LIST_KEY: KeyField[] = [
  { field: "name", dir: "asc", kind: "string" },
  { field: "id", dir: "asc", kind: "string" },
];

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Catálogo de produtos (Fase 5a, docs/plano-fase-5-produtos-stock.md): produtos, fornecedores de cada produto (com a
 * referência e o custo do fornecedor) e um preferido por produto. Os custos e a margem só saem para quem pode
 * escrever no catálogo.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Quem pode escrever no catálogo vê custos e margens. */
  seesCosts(role: Role | undefined) {
    return this.permissions.canWrite(role, "catalog");
  }

  private view(p: ProductRow, seesCosts: boolean) {
    const { suppliers, ...rest } = p;
    const salePrice = num(p.salePrice);
    const vatRate = Number(p.vatRate);
    const supplierViews = suppliers.map((s) => ({
      id: s.id,
      company: s.company,
      supplierSku: s.supplierSku,
      preferred: s.preferredFor !== null,
      ...(seesCosts ? { costPrice: num(s.costPrice) } : {}),
    }));
    const preferred = suppliers.find((s) => s.preferredFor !== null);
    const preferredCost = preferred ? num(preferred.costPrice) : null;
    return {
      ...rest,
      salePrice,
      vatRate,
      minStock: num(p.minStock),
      salePriceWithVat: salePrice === null ? null : round2(salePrice * (1 + vatRate / 100)),
      suppliers: supplierViews,
      preferredSupplier: preferred ? preferred.company : null,
      // Margem sobre o preço de venda, com o custo do preferido.
      ...(seesCosts
        ? { margin: salePrice !== null && salePrice > 0 && preferredCost !== null ? Math.round(((salePrice - preferredCost) / salePrice) * 1000) / 10 : null }
        : {}),
    };
  }

  async findPage(query: QueryProductsDto, role: Role | undefined) {
    const where: Prisma.ProductWhereInput = {};
    const term = query.search?.trim();
    if (term) {
      // Referência, nome, código de barras e descrição sem acentos (trigger, índice pg_trgm) ou a referência do fornecedor.
      where.OR = [{ searchText: { contains: foldSearch(term) } }, { suppliers: { some: { supplierSku: { contains: term, mode: "insensitive" } } } }];
    }
    if ((query.active ?? "true") !== "all") where.active = (query.active ?? "true") === "true";
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.tracksStock) where.tracksStock = query.tracksStock === "true";
    if (query.supplierId) where.suppliers = { some: { companyId: query.supplierId } };

    const seesCosts = this.seesCosts(role);
    const page = await readPage(LIST_KEY, query, (after, take) =>
      this.prisma.product.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(LIST_KEY), take, include: INCLUDE }),
    );
    return { ...page, items: page.items.map((p) => this.view(p, seesCosts)) };
  }

  async findOne(id: string, role: Role | undefined) {
    return this.view(await this.load(id), this.seesCosts(role));
  }

  private async load(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: INCLUDE });
    if (!product) throw new NotFoundException("Produto não encontrado");
    return product;
  }

  async create(dto: CreateProductDto, role: Role | undefined) {
    if (dto.categoryId) await this.assertCategory(dto.categoryId);
    const product = await this.write(() =>
      this.prisma.product.create({
        data: {
          sku: normalizeSku(dto.sku),
          barcode: dto.barcode?.trim() || null,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          unit: dto.unit,
          salePrice: dto.salePrice ?? null,
          vatRate: dto.vatRate,
          categoryId: dto.categoryId ?? null,
          active: dto.active,
          tracksStock: dto.tracksStock,
          minStock: dto.minStock ?? null,
        },
        include: INCLUDE,
      }),
    );
    return this.view(product, this.seesCosts(role));
  }

  async update(id: string, dto: UpdateProductDto, role: Role | undefined) {
    const existing = await this.load(id);
    if (dto.categoryId && dto.categoryId !== existing.categoryId) await this.assertCategory(dto.categoryId);
    const product = await this.write(() =>
      this.prisma.product.update({
        where: { id },
        data: {
          sku: dto.sku === undefined ? undefined : normalizeSku(dto.sku),
          barcode: dto.barcode === undefined ? undefined : dto.barcode?.trim() || null,
          name: dto.name?.trim(),
          description: dto.description === undefined ? undefined : dto.description?.trim() || null,
          unit: dto.unit,
          salePrice: dto.salePrice,
          vatRate: dto.vatRate,
          categoryId: dto.categoryId,
          active: dto.active,
          tracksStock: dto.tracksStock,
          minStock: dto.minStock,
        },
        include: INCLUDE,
      }),
    );
    return this.view(product, this.seesCosts(role));
  }

  /** Só enquanto nada usa o produto (a partir da 5c e da Fase 6, um produto usado desativa-se). */
  async remove(id: string) {
    await this.load(id);
    await this.prisma.product.delete({ where: { id } });
  }

  // ---- Fornecedores do produto ----

  /** Liga um fornecedor (marca a empresa como fornecedor). O primeiro fica preferido. */
  async addSupplier(productId: string, dto: AddProductSupplierDto, role: Role | undefined) {
    await this.load(productId);
    const company = await this.prisma.company.findUnique({ where: { id: dto.companyId }, select: { id: true, isSupplier: true } });
    if (!company) throw new NotFoundException("Empresa não encontrada");
    const isFirst = (await this.prisma.productSupplier.count({ where: { productId } })) === 0;
    const preferred = dto.preferred ?? isFirst;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (preferred) await tx.productSupplier.updateMany({ where: { productId, preferredFor: { not: null } }, data: { preferredFor: null } });
        await tx.productSupplier.create({
          data: { productId, companyId: dto.companyId, supplierSku: dto.supplierSku?.trim() || null, costPrice: dto.costPrice ?? null, preferredFor: preferred ? productId : null },
        });
        if (!company.isSupplier) await tx.company.update({ where: { id: company.id }, data: { isSupplier: true } });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("Esse fornecedor já está ligado ao produto");
      }
      throw err;
    }
    return this.findOne(productId, role);
  }

  async updateSupplier(productId: string, supplierId: string, dto: UpdateProductSupplierDto, role: Role | undefined) {
    await this.findSupplier(productId, supplierId);
    await this.prisma.$transaction(async (tx) => {
      if (dto.preferred === true) await tx.productSupplier.updateMany({ where: { productId, preferredFor: { not: null }, id: { not: supplierId } }, data: { preferredFor: null } });
      await tx.productSupplier.update({
        where: { id: supplierId },
        data: {
          supplierSku: dto.supplierSku === undefined ? undefined : dto.supplierSku?.trim() || null,
          costPrice: dto.costPrice,
          preferredFor: dto.preferred === undefined ? undefined : dto.preferred ? productId : null,
        },
      });
    });
    return this.findOne(productId, role);
  }

  async removeSupplier(productId: string, supplierId: string) {
    await this.findSupplier(productId, supplierId);
    await this.prisma.productSupplier.delete({ where: { id: supplierId } });
  }

  private async findSupplier(productId: string, supplierId: string) {
    const link = await this.prisma.productSupplier.findFirst({ where: { id: supplierId, productId } });
    if (!link) throw new NotFoundException("Fornecedor não encontrado neste produto");
    return link;
  }

  private async assertCategory(categoryId: string) {
    const category = await this.prisma.productCategory.findUnique({ where: { id: categoryId }, select: { active: true } });
    if (!category) throw new BadRequestException("Categoria não encontrada");
    if (!category.active) throw new BadRequestException("Essa categoria está desativada");
  }

  /** Referência e código de barras únicos: 409 com a mensagem certa. */
  private async write<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const target = String((err.meta as { target?: string[] | string } | undefined)?.target ?? "");
        throw new ConflictException(target.includes("barcode") ? "Já existe um produto com esse código de barras" : "Já existe um produto com essa referência");
      }
      throw err;
    }
  }
}
