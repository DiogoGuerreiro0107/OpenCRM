import { Module } from "@nestjs/common";
import { CarriersController, OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { CarriersService } from "./carriers.service";
import { OrderPreparationModule } from "./order-preparation.module";

/** Módulo opcional «Encomendas» (Fase 6a; depende de «Produtos»). */
@Module({
  imports: [OrderPreparationModule],
  controllers: [OrdersController, CarriersController],
  providers: [OrdersService, CarriersService],
  exports: [OrdersService],
})
export class OrdersModule {}
