import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductCategoryDto, UpdateProductCategoryDto } from "./dto/product.dto";

/** Nome sem maiúsculas nem espaços nas pontas: «Toners» e « toners » são a mesma categoria. */
const keyOf = (name: string) => name.trim().toLocaleLowerCase("pt-PT");

/** Categorias de produtos (Fase 5a): lista simples, sempre curta (vem inteira). Em uso, desativa-se em vez de apagar. */
@Injectable()
export class ProductCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const categories = await this.prisma.productCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } });
    return categories.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
  }

  async create(dto: CreateProductCategoryDto) {
    return this.write(() => this.prisma.productCategory.create({ data: { name: dto.name.trim(), nameKey: keyOf(dto.name), sortOrder: dto.sortOrder, active: dto.active } }));
  }

  async update(id: string, dto: UpdateProductCategoryDto) {
    await this.find(id);
    return this.write(() =>
      this.prisma.productCategory.update({
        where: { id },
        data: { name: dto.name?.trim(), nameKey: dto.name === undefined ? undefined : keyOf(dto.name), sortOrder: dto.sortOrder, active: dto.active },
      }),
    );
  }

  async remove(id: string) {
    await this.find(id);
    if ((await this.prisma.product.count({ where: { categoryId: id } })) > 0) {
      throw new ConflictException("A categoria tem produtos: desativa-a em vez de a apagar");
    }
    await this.prisma.productCategory.delete({ where: { id } });
  }

  private async find(id: string) {
    const category = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException("Categoria não encontrada");
    return category;
  }

  private async write<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictException("Já existe uma categoria com esse nome");
      throw err;
    }
  }
}
