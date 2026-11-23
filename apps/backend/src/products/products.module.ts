import { Module } from "@nestjs/common";
import { ProductCategoriesController, ProductsController } from "./products.controller";
import { ProductsService } from "./products.service";
import { ProductCategoriesService } from "./product-categories.service";

/** Módulo opcional «Produtos» (Fase 5a): catálogo, categorias e fornecedores dos produtos. */
@Module({
  controllers: [ProductsController, ProductCategoriesController],
  providers: [ProductsService, ProductCategoriesService],
  exports: [ProductsService],
})
export class ProductsModule {}
