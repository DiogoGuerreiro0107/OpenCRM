import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module";
import { OrdersModule } from "../orders/orders.module";
import { ApiKeyGuard } from "./api-key.guard";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { IdempotencyCleanupService } from "./idempotency-cleanup.service";
import { PublicApiService } from "./public-api.service";
import { PublicCommerceService } from "./public-commerce.service";
import { V1OrdersController, V1ProductsController } from "./v1-commerce.controller";
import { V1CrmController } from "./v1-crm.controller";
import { V1LeadsController } from "./v1-leads.controller";
import { V1MetaController } from "./v1-meta.controller";

/** API pública `/api/v1` (núcleo; as rotas de leads, produtos e encomendas respeitam o interruptor do módulo). */
@Module({
  imports: [LeadsModule, OrdersModule],
  controllers: [V1MetaController, V1CrmController, V1LeadsController, V1ProductsController, V1OrdersController],
  // ApiKeyGuard é um único fornecedor (partilha o limitador e o registo de `lastUsedAt` entre controllers).
  providers: [ApiKeyGuard, IdempotencyInterceptor, IdempotencyCleanupService, PublicApiService, PublicCommerceService],
})
export class PublicApiModule {}
