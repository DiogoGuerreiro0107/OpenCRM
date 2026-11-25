import { Module } from "@nestjs/common";
import { OrderPreparationModule } from "../orders/order-preparation.module";
import { PurchasesController } from "./purchases.controller";
import { PurchasesService } from "./purchases.service";

/** Módulo opcional «Compras a fornecedor» (Fase 6c; depende de «Produtos» e «Stock»). */
@Module({
  imports: [OrderPreparationModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
