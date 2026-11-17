import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { EVENT_CATALOG } from "./webhook-core";
import { WebhookSubscriptionsService } from "./webhook-subscriptions.service";
import { CreateWebhookDto, QueryDeliveriesDto, UpdateWebhookDto } from "./dto/webhook.dto";

/**
 * Gestão dos webhooks de saída (só o Administrador: leituras incluídas, porque os URLs de destino podem conter
 * tokens). O URL nunca vai para a auditoria pelo mesmo motivo.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WRITE_ACCESS.adminOnly)
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly subscriptions: WebhookSubscriptionsService) {}

  /** Eventos que o CRM publica, com a descrição (para o formulário). */
  @Get("events")
  events() {
    return Object.entries(EVENT_CATALOG).map(([type, description]) => ({ type, description }));
  }

  @Get("subscriptions")
  list() {
    return this.subscriptions.list();
  }

  @Audit("webhook.created", { target: "webhook", fields: ["name", "events"] })
  @Post("subscriptions")
  create(@Body() dto: CreateWebhookDto, @CurrentUser() user: { userId: string }) {
    return this.subscriptions.create(dto, user.userId);
  }

  @Audit("webhook.updated", { target: "webhook", fields: ["name", "events", "active"], presence: { destino: ["url"] } })
  @Patch("subscriptions/:id")
  update(@Param("id") id: string, @Body() dto: UpdateWebhookDto) {
    return this.subscriptions.update(id, dto);
  }

  @Audit("webhook.deleted", { target: "webhook" })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete("subscriptions/:id")
  async remove(@Param("id") id: string) {
    await this.subscriptions.remove(id);
  }

  @Audit("webhook.secret_rotated", { target: "webhook" })
  @HttpCode(HttpStatus.OK)
  @Post("subscriptions/:id/rotate-secret")
  rotateSecret(@Param("id") id: string) {
    return this.subscriptions.rotateSecret(id);
  }

  @Audit("webhook.test_sent", { target: "webhook" })
  @HttpCode(HttpStatus.OK)
  @Post("subscriptions/:id/test")
  sendTest(@Param("id") id: string) {
    return this.subscriptions.sendTest(id);
  }

  @Get("deliveries")
  deliveries(@Query() query: QueryDeliveriesDto) {
    return this.subscriptions.listDeliveries(query);
  }

  @Audit("webhook.delivery_retried", { target: "webhook_delivery" })
  @HttpCode(HttpStatus.OK)
  @Post("deliveries/:id/redeliver")
  redeliver(@Param("id") id: string) {
    return this.subscriptions.redeliver(id);
  }
}
