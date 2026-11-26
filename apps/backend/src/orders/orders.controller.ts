import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteArea } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Audit } from "../audit/audit.decorator";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { OrdersService } from "./orders.service";
import { CarriersService } from "./carriers.service";
import {
  CancelOrderDto,
  CreateCarrierDto,
  CreateOrderDto,
  CreateOrderLineDto,
  FinishOrderDto,
  QueryOrdersDto,
  ShipOrderDto,
  UpdateCarrierDto,
  UpdateOrderDto,
  UpdateOrderLineDto,
  UpdateShipmentDto,
} from "./dto/order.dto";

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
    return this.orders.confirm(id, user.userId);
  }

  /** Reserva o stock disponível para as linhas à espera (Fase 6b). */
  @Post(":id/reserve")
  @HttpCode(HttpStatus.OK)
  reserve(@Param("id") id: string, @CurrentUser() user: Actor) {
    return this.orders.reserve(id, user.userId);
  }

  /**
   * Regista uma expedição (Fase 6d): tudo o que falta enviar ou só parte (`lines`). Lança as saídas de stock e
   * liberta as reservas do que sai (Fase 6b). Enviar sem stock reservado fica na auditoria.
   */
  @Post(":id/ship")
  @HttpCode(HttpStatus.OK)
  @Audit("order.shipped", { target: "order", fields: ["allowShortage", "lines", "carrierId", "trackingCode"] })
  ship(@Param("id") id: string, @Body() dto: ShipOrderDto, @CurrentUser() user: Actor) {
    return this.orders.ship(id, dto, user.userId);
  }

  /** Corrige os dados do transporte de uma expedição (Fase 6d); as quantidades não mudam. */
  @Patch(":id/shipments/:shipmentId")
  updateShipment(@Param("id") id: string, @Param("shipmentId") shipmentId: string, @Body() dto: UpdateShipmentDto, @CurrentUser() user: Actor) {
    return this.orders.updateShipment(id, shipmentId, dto, user.userId);
  }

  /** «Dar por enviada sem o resto» (Fase 6d): com parte enviada, o que falta não vai. */
  @Post(":id/finish")
  @HttpCode(HttpStatus.OK)
  @Audit("order.finished", { target: "order", fields: ["reason"] })
  finish(@Param("id") id: string, @Body() dto: FinishOrderDto, @CurrentUser() user: Actor) {
    return this.orders.finish(id, dto, user.userId);
  }

  @Post(":id/deliver")
  @HttpCode(HttpStatus.OK)
  deliver(@Param("id") id: string, @CurrentUser() user: Actor) {
    return this.orders.deliver(id, user.userId);
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  @Audit("order.cancelled", { target: "order", fields: ["reason"] })
  cancel(@Param("id") id: string, @Body() dto: CancelOrderDto, @CurrentUser() user: Actor) {
    return this.orders.cancel(id, dto, user.userId);
  }
}

/** Transportadoras (Fase 6d): configuração das expedições, com a área «Encomendas». */
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("encomendas")
@WriteArea("orders")
@Controller("carriers")
export class CarriersController {
  constructor(private readonly carriers: CarriersService) {}

  @Get()
  list() {
    return this.carriers.list();
  }

  @Post()
  create(@Body() dto: CreateCarrierDto) {
    return this.carriers.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCarrierDto) {
    return this.carriers.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.carriers.remove(id);
  }
}
