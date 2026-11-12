import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, WebhookDelivery, WebhookSubscription } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SecretsService } from "../common/secrets.service";
import { decodeCursor, encodeCursor } from "../common/cursor";
import { generateWebhookSecret, isValidEventPattern, webhookUrlProblem } from "./webhook-core";
import { WebhookDispatcher, WEBHOOK_SECRET_CONTEXT } from "./webhook-dispatcher.service";
import { CreateWebhookDto, QueryDeliveriesDto, UpdateWebhookDto } from "./dto/webhook.dto";

/** O que a API de gestão devolve de uma subscrição: NUNCA o segredo. */
export function subscriptionView(s: WebhookSubscription) {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    events: s.events,
    active: s.active,
    disabledReason: s.disabledReason,
    consecutiveFailures: s.consecutiveFailures,
    lastSuccessAt: s.lastSuccessAt,
    lastFailureAt: s.lastFailureAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Entrega na lista: sem o envelope completo (pode ser grande); só o suficiente para diagnosticar. */
export function deliveryView(d: WebhookDelivery) {
  return {
    id: d.id,
    subscriptionId: d.subscriptionId,
    eventId: d.eventId,
    eventType: d.eventType,
    status: d.status,
    attempts: d.attempts,
    nextAttemptAt: d.status === "PENDING" ? d.nextAttemptAt : null,
    lastStatusCode: d.lastStatusCode,
    lastError: d.lastError,
    createdAt: d.createdAt,
    deliveredAt: d.deliveredAt,
  };
}

@Injectable()
export class WebhookSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  private validate(url: string | undefined, events: string[] | undefined) {
    if (url !== undefined) {
      const problem = webhookUrlProblem(url);
      if (problem) throw new BadRequestException(problem);
    }
    const invalid = (events ?? []).filter((e) => !isValidEventPattern(e));
    if (invalid.length > 0) throw new BadRequestException(`Evento inválido: ${invalid.join(", ")}`);
  }

  private async findOrThrow(id: string) {
    const subscription = await this.prisma.webhookSubscription.findUnique({ where: { id } });
    if (!subscription) throw new NotFoundException("Webhook não encontrado");
    return subscription;
  }

  async list() {
    const subscriptions = await this.prisma.webhookSubscription.findMany({ orderBy: { createdAt: "desc" } });
    return subscriptions.map(subscriptionView);
  }

  /** Devolve o segredo de assinatura UMA ÚNICA VEZ (`secret`). */
  async create(dto: CreateWebhookDto, creatorId: string) {
    this.validate(dto.url, dto.events);
    const secret = generateWebhookSecret();
    const subscription = await this.prisma.webhookSubscription.create({
      data: {
        name: dto.name,
        url: dto.url,
        events: dto.events,
        secret: this.secrets.encrypt(secret, WEBHOOK_SECRET_CONTEXT),
        createdById: creatorId,
      },
    });
    return { ...subscriptionView(subscription), secret };
  }

  async update(id: string, dto: UpdateWebhookDto) {
    const existing = await this.findOrThrow(id);
    this.validate(dto.url, dto.events);
    // Reativar à mão (depois do disjuntor) limpa o motivo e a contagem, para ter uma nova oportunidade.
    const reactivating = dto.active === true && !existing.active;
    const updated = await this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        name: dto.name,
        url: dto.url,
        events: dto.events,
        active: dto.active,
        ...(reactivating ? { consecutiveFailures: 0, disabledReason: null } : {}),
      },
    });
    return subscriptionView(updated);
  }

  /** O segredo antigo deixa de valer imediatamente. O novo é devolvido uma única vez. */
  async rotateSecret(id: string) {
    await this.findOrThrow(id);
    const secret = generateWebhookSecret();
    const updated = await this.prisma.webhookSubscription.update({
      where: { id },
      data: { secret: this.secrets.encrypt(secret, WEBHOOK_SECRET_CONTEXT) },
    });
    return { ...subscriptionView(updated), secret };
  }

  /** Apaga a subscrição e o seu registo de entregas (a auditoria guarda quem a apagou). */
  async remove(id: string) {
    await this.findOrThrow(id);
    await this.prisma.webhookSubscription.delete({ where: { id } });
  }

  async sendTest(id: string) {
    const subscription = await this.findOrThrow(id);
    if (!subscription.active) throw new BadRequestException("O webhook está desativado; ativa-o antes de enviar um teste");
    const [deliveryId] = await this.dispatcher.enqueueFor(id, "webhook.test", { message: "Evento de teste do OpenCRM", subscriptionName: subscription.name });
    return { deliveryId };
  }

  async listDeliveries(query: QueryDeliveriesDto) {
    const limit = query.limit ?? 50;
    const where: Prisma.WebhookDeliveryWhereInput = { subscriptionId: query.subscriptionId, status: query.status };
    const cursor = decodeCursor(query.cursor);
    if (cursor) where.OR = [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }];

    const rows = await this.prisma.webhookDelivery.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 });
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items: items.map(deliveryView), nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  /**
   * Reenvia: cria uma entrega NOVA com o mesmo evento (o mesmo `id`, para o consumidor deduplicar se já o tinha
   * recebido). A entrega original fica como estava, para o histórico não mentir.
   */
  async redeliver(deliveryId: string) {
    const original = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId }, include: { subscription: true } });
    if (!original) throw new NotFoundException("Entrega não encontrada");
    if (original.status === "PENDING") throw new BadRequestException("Esta entrega ainda está na fila");
    if (!original.subscription.active) throw new BadRequestException("O webhook está desativado; ativa-o antes de reenviar");

    const created = await this.prisma.webhookDelivery.create({
      data: {
        subscriptionId: original.subscriptionId,
        eventId: original.eventId,
        eventType: original.eventType,
        payload: original.payload as Prisma.InputJsonValue,
      },
    });
    setImmediate(() => void this.dispatcher.attempt(created.id).catch(() => undefined));
    return deliveryView(created);
  }
}
