import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteArea } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Audit } from "../audit/audit.decorator";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { ProductsService } from "./products.service";
import { ProductCategoriesService } from "./product-categories.service";
import {
  AddProductSupplierDto,
  CreateProductCategoryDto,
  CreateProductDto,
  QueryProductsDto,
  UpdateProductCategoryDto,
  UpdateProductDto,
  UpdateProductSupplierDto,
} from "./dto/product.dto";

type Actor = { userId: string; role: Role };

const PRODUCT_FIELDS = ["sku", "name", "salePrice", "vatRate", "active", "tracksStock"];
const SUPPLIER_FIELDS = ["companyId", "supplierSku", "costPrice", "preferred"];

/**
 * Catálogo de produtos (módulo `produtos`, Fase 5a). Ler é para todos; escrever usa a área «Catálogo de produtos».
 * Preços e custos ficam na auditoria.
 */
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("produtos")
@WriteArea("catalog")
@Controller("products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  findPage(@Query() query: QueryProductsDto, @CurrentUser() user: Actor) {
    return this.products.findPage(query, user.role);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: Actor) {
    return this.products.findOne(id, user.role);
  }

  @Post()
  @Audit("product.created", { target: "product", fields: PRODUCT_FIELDS })
  create(@Body() dto: CreateProductDto, @CurrentUser() user: Actor) {
    return this.products.create(dto, user.role);
  }

  @Patch(":id")
  @Audit("product.updated", { target: "product", fields: PRODUCT_FIELDS })
  update(@Param("id") id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: Actor) {
    return this.products.update(id, dto, user.role);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit("product.deleted", { target: "product" })
  remove(@Param("id") id: string) {
    return this.products.remove(id);
  }

  @Post(":id/suppliers")
  @Audit("product.supplier_added", { target: "product", fields: SUPPLIER_FIELDS })
  addSupplier(@Param("id") id: string, @Body() dto: AddProductSupplierDto, @CurrentUser() user: Actor) {
    return this.products.addSupplier(id, dto, user.role);
  }

  @Patch(":id/suppliers/:supplierId")
  @Audit("product.supplier_updated", { target: "product", fields: SUPPLIER_FIELDS })
  updateSupplier(@Param("id") id: string, @Param("supplierId") supplierId: string, @Body() dto: UpdateProductSupplierDto, @CurrentUser() user: Actor) {
    return this.products.updateSupplier(id, supplierId, dto, user.role);
  }

  @Delete(":id/suppliers/:supplierId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit("product.supplier_removed", { target: "product" })
  removeSupplier(@Param("id") id: string, @Param("supplierId") supplierId: string) {
    return this.products.removeSupplier(id, supplierId);
  }
}

/** Categorias de produtos (Fase 5a). */
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("produtos")
@WriteArea("catalog")
@Controller("product-categories")
export class ProductCategoriesController {
  constructor(private readonly categories: ProductCategoriesService) {}

  @Get()
  list() {
    return this.categories.list();
  }

  @Post()
  create(@Body() dto: CreateProductCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateProductCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.categories.remove(id);
  }
}
