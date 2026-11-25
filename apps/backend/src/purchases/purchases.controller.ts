import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteArea } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Audit } from "../audit/audit.decorator";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { PurchasesService } from "./purchases.service";
import {
  ClosePurchaseDto,
  CreatePurchaseLineDto,
  CreatePurchaseOrderDto,
  GeneratePurchasesDto,
  QueryPurchaseOrdersDto,
  ReceivePurchaseDto,
  UpdatePurchaseLineDto,
  UpdatePurchaseOrderDto,
} from "./dto/purchase.dto";

type Actor = { userId: string; role: Role };

/**
 * Compras a fornecedor (módulo `compras`, Fase 6c). Ver é para todos (os custos só com a área «Catálogo de produtos»);
 * escrever usa a área «Compras a fornecedor». Cada mudança fica na timeline da compra; enviar, receber, fechar,
 * cancelar, apagar e criar a partir das sugestões também na auditoria.
 */
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("compras")
@WriteArea("purchases")
@Controller("purchase-orders")
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  findPage(@Query() query: QueryPurchaseOrdersDto, @CurrentUser() user: Actor) {
    return this.purchases.findPage(query, user.role);
  }

  /** O que comprar para as encomendas à espera (precisa do módulo «Encomendas»). */
  @Get("suggestions")
  suggestions(@CurrentUser() user: Actor) {
    return this.purchases.suggestions(user.role);
  }

  @Post("generate")
  @HttpCode(HttpStatus.OK)
  @Audit("purchase.generated", { target: "purchase", fields: ["productIds"] })
  generate(@Body() dto: GeneratePurchasesDto, @CurrentUser() user: Actor) {
    return this.purchases.generate(dto, user.userId);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: Actor) {
    return this.purchases.findOne(id, user.role);
  }

  @Post()
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: Actor) {
    return this.purchases.create(dto, user.userId, user.role);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdatePurchaseOrderDto, @CurrentUser() user: Actor) {
    return this.purchases.update(id, dto, user.userId, user.role);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit("purchase.deleted", { target: "purchase" })
  remove(@Param("id") id: string) {
    return this.purchases.remove(id);
  }

  @Post(":id/lines")
  addLine(@Param("id") id: string, @Body() dto: CreatePurchaseLineDto, @CurrentUser() user: Actor) {
    return this.purchases.addLine(id, dto, user.userId, user.role);
  }

  @Patch(":id/lines/:lineId")
  updateLine(@Param("id") id: string, @Param("lineId") lineId: string, @Body() dto: UpdatePurchaseLineDto, @CurrentUser() user: Actor) {
    return this.purchases.updateLine(id, lineId, dto, user.userId, user.role);
  }

  @Delete(":id/lines/:lineId")
  removeLine(@Param("id") id: string, @Param("lineId") lineId: string, @CurrentUser() user: Actor) {
    return this.purchases.removeLine(id, lineId, user.userId, user.role);
  }

  @Post(":id/send")
  @HttpCode(HttpStatus.OK)
  @Audit("purchase.sent", { target: "purchase" })
  send(@Param("id") id: string, @CurrentUser() user: Actor) {
    return this.purchases.send(id, user.userId, user.role);
  }

  @Post(":id/receive")
  @HttpCode(HttpStatus.OK)
  @Audit("purchase.received", { target: "purchase", fields: ["lines", "note"] })
  receive(@Param("id") id: string, @Body() dto: ReceivePurchaseDto, @CurrentUser() user: Actor) {
    return this.purchases.receive(id, dto, user.userId, user.role);
  }

  @Post(":id/close")
  @HttpCode(HttpStatus.OK)
  @Audit("purchase.closed", { target: "purchase", fields: ["reason"] })
  close(@Param("id") id: string, @Body() dto: ClosePurchaseDto, @CurrentUser() user: Actor) {
    return this.purchases.close(id, dto, user.userId, user.role);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @Audit("purchase.cancelled", { target: "purchase", fields: ["reason"] })
  cancel(@Param("id") id: string, @Body() dto: ClosePurchaseDto, @CurrentUser() user: Actor) {
    return this.purchases.cancel(id, dto, user.userId, user.role);
  }
}
