import { Module } from "@nestjs/common";
import { TasksModule } from "../tasks/tasks.module";
import { OrderPreparationService } from "./order-preparation.service";

/** Tarefa «Preparar encomenda» (Fase 6c): usada pelo stock, pelas peças, pelas encomendas e pelas compras. */
@Module({
  imports: [TasksModule],
  providers: [OrderPreparationService],
  exports: [OrderPreparationService],
})
export class OrderPreparationModule {}
