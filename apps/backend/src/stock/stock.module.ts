import { Module } from "@nestjs/common";
import { StockController } from "./stock.controller";
import { StockService } from "./stock.service";
import { OrderPreparationModule } from "../orders/order-preparation.module";

/** Módulo opcional «Stock» (Fase 5b; depende de «Produtos»). */
@Module({
  imports: [OrderPreparationModule],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
