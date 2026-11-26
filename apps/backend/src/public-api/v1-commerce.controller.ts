import { Body, Controller, Get, Param, Post, Query, Req, UseFilters, UseGuards, UseInterceptors } from "@nestjs/common";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { ApiKeyGuard, AuthenticatedApiKey } from "./api-key.guard";
import { Idempotent } from "./idempotency";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { PublicCommerceService } from "./public-commerce.service";
import { Scopes } from "./scopes.decorator";
import { V1ExceptionFilter } from "./v1-error.filter";
import { V1CreateOrderDto, V1ListOrdersQueryDto, V1ListProductsQueryDto } from "./dto/v1-orders.dto";

/**
 * API PÚBLICA v1 — produtos e encomendas (Fase 6e). Autenticação SÓ por chave de API (nunca JWT). Contrato:
 * docs/api-publica.md. Cada rota declara @Scopes(...) (teste estrutural). Com o módulo desligado, 404.
 */

type ApiRequest = { apiKey: AuthenticatedApiKey };

@UseGuards(ApiKeyGuard, ModuleGuard)
@RequireModule("produtos")
@UseFilters(V1ExceptionFilter)
@Controller("api/v1")
export class V1ProductsController {
  constructor(private readonly service: PublicCommerceService) {}

  @Scopes("products:read")
  @Get("products")
  listProducts(@Query() query: V1ListProductsQueryDto) {
    return this.service.listProducts(query);
  }

  @Scopes("products:read")
  @Get("products/:id")
  getProduct(@Param("id") id: string) {
    return this.service.getProduct(id);
  }
}

@UseGuards(ApiKeyGuard, ModuleGuard)
@RequireModule("encomendas")
@UseInterceptors(IdempotencyInterceptor)
@UseFilters(V1ExceptionFilter)
@Controller("api/v1")
export class V1OrdersController {
  constructor(private readonly service: PublicCommerceService) {}

  @Scopes("orders:read")
  @Get("orders")
  listOrders(@Query() query: V1ListOrdersQueryDto, @Req() request: ApiRequest) {
    return this.service.listOrders(query, request.apiKey);
  }

  @Scopes("orders:read")
  @Get("orders/:id")
  getOrder(@Param("id") id: string, @Req() request: ApiRequest) {
    return this.service.getOrder(id, request.apiKey);
  }

  @Scopes("orders:write")
  @Idempotent({ required: true })
  @Post("orders")
  createOrder(@Body() dto: V1CreateOrderDto, @Req() request: ApiRequest) {
    return this.service.createOrder(dto, request.apiKey);
  }
}
