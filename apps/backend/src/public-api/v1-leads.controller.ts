import { Body, Controller, Post, Req, UseFilters, UseGuards, UseInterceptors } from "@nestjs/common";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { ApiKeyGuard, AuthenticatedApiKey } from "./api-key.guard";
import { Idempotent } from "./idempotency";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { PublicApiService } from "./public-api.service";
import { Scopes } from "./scopes.decorator";
import { V1ExceptionFilter } from "./v1-error.filter";
import { V1CreateLeadDto } from "./dto/v1-create-lead.dto";

/**
 * API PÚBLICA v1. Autenticação SÓ por chave de API (nunca JWT). Contrato e política de versões: docs/api-publica.md.
 * Cada rota tem de declarar @Scopes(...) (teste estrutural). Dentro da v1 só se acrescenta.
 */

@UseGuards(ApiKeyGuard, ModuleGuard)
@RequireModule("leads")
@UseInterceptors(IdempotencyInterceptor)
@UseFilters(V1ExceptionFilter)
@Controller("api/v1")
export class V1LeadsController {
  constructor(private readonly service: PublicApiService) {}

  @Scopes("leads:write")
  @Idempotent({ required: true })
  @Post("leads")
  createLead(@Body() dto: V1CreateLeadDto, @Req() request: { apiKey: AuthenticatedApiKey }) {
    return this.service.createLead(dto, request.apiKey);
  }
}
