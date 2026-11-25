import { Module } from "@nestjs/common";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { OrderPreparationModule } from "./order-preparation.module";

/** Módulo opcional «Encomendas» (Fase 6a; depende de «Produtos»). */
@Module({
  imports: [OrderPreparationModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
