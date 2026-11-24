import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteArea } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Audit } from "../audit/audit.decorator";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { OrdersService } from "./orders.service";
import { CancelOrderDto, CreateOrderDto, CreateOrderLineDto, QueryOrdersDto, UpdateOrderDto, UpdateOrderLineDto } from "./dto/order.dto";

type Actor = { userId: string };

/**
 * Encomendas de cliente (módulo `encomendas`, Fase 6a). Ver é para todos; escrever usa a área «Encomendas». Cada
 * mudança fica na timeline da encomenda; confirmar, cancelar e apagar também na auditoria.
 */
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("encomendas")
@WriteArea("orders")
@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  findPage(@Query() query: QueryOrdersDto) {
    return this.orders.findPage(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.orders.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: Actor) {
    return this.orders.create(dto, user.userId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateOrderDto, @CurrentUser() user: Actor) {
    return this.orders.update(id, dto, user.userId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit("order.deleted", { target: "order" })
  remove(@Param("id") id: string) {
    return this.orders.remove(id);
  }

  @Post(":id/lines")
  addLine(@Param("id") id: string, @Body() dto: CreateOrderLineDto, @CurrentUser() user: Actor) {
    return this.orders.addLine(id, dto, user.userId);
  }

  @Patch(":id/lines/:lineId")
  updateLine(@Param("id") id: string, @Param("lineId") lineId: string, @Body() dto: UpdateOrderLineDto, @CurrentUser() user: Actor) {
    return this.orders.updateLine(id, lineId, dto, user.userId);
  }

  @Delete(":id/lines/:lineId")
  removeLine(@Param("id") id: string, @Param("lineId") lineId: string, @CurrentUser() user: Actor) {
    return this.orders.removeLine(id, lineId, user.userId);
  }

  @Post(":id/confirm")
  @HttpCode(HttpStatus.OK)
  @Audit("order.confirmed", { target: "order" })
  confirm(@Param("id") id: string, @CurrentUser() user: Actor) {
    return this.orders.advance(id, "confirm", user.userId);
  }

  @Post(":id/ship")
  @HttpCode(HttpStatus.OK)
  ship(@Param("id") id: string, @CurrentUser() user: Actor) {
    return this.orders.advance(id, "ship", user.userId);
  }

  @Post(":id/deliver")
  @HttpCode(HttpStatus.OK)
  deliver(@Param("id") id: string, @CurrentUser() user: Actor) {
    return this.orders.advance(id, "deliver", user.userId);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @Audit("order.cancelled", { target: "order", fields: ["reason"] })
  cancel(@Param("id") id: string, @Body() dto: CancelOrderDto, @CurrentUser() user: Actor) {
    return this.orders.cancel(id, dto, user.userId);
  }
}
