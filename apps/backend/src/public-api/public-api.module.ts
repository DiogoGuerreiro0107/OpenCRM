import { Module } from "@nestjs/common";
import { LeadsModule } from "../leads/leads.module";
import { ApiKeyGuard } from "./api-key.guard";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { PublicApiService } from "./public-api.service";
import { V1CrmController } from "./v1-crm.controller";
import { V1LeadsController } from "./v1-leads.controller";
import { V1MetaController } from "./v1-meta.controller";

/** API pública `/api/v1` (núcleo; a rota de leads respeita o interruptor do módulo de leads). */
@Module({
  imports: [LeadsModule],
  controllers: [V1MetaController, V1CrmController, V1LeadsController],
  // ApiKeyGuard é um único fornecedor (partilha o limitador e o registo de `lastUsedAt` entre controllers).
  providers: [ApiKeyGuard, IdempotencyInterceptor, PublicApiService],
})
export class PublicApiModule {}
