import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import axios from "axios";
import { PrismaService } from "../prisma/prisma.service";
import { SecretsService } from "../common/secrets.service";
import { AuditService } from "../audit/audit.service";
import {
  buildEnvelope,
  CIRCUIT_BREAKER_THRESHOLD,
  DELIVERY_TIMEOUT_MS,
  nextAttemptDelayMs,
  signPayload,
  subscriptionWants,
} from "./webhook-core";

export const WEBHOOK_SECRET_CONTEXT = "WebhookSubscription.secret";
/** Enquanto uma entrega está a ser enviada fica reservada este tempo (tem de ser maior do que o tempo-limite). */
const LOCK_MS = DELIVERY_TIMEOUT_MS + 20_000;
const BATCH = 50;

/**
 * Fila de entregas dos webhooks de saída. A entrega é gravada ANTES de se tentar enviar; tenta-se logo e, se falhar,
 * o agendador repete com recuo. Garantia: pelo menos uma vez (o consumidor deduplica pelo `id` do evento).
 */
@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly audit: AuditService,
  ) {}

  /** Cria uma entrega por cada subscrição ativa que quer este evento e tenta enviá-las já. Devolve os ids. */
  async enqueue(type: string, data: unknown): Promise<string[]> {
    const subscriptions = await this.prisma.webhookSubscription.findMany({ where: { active: true }, select: { id: true, events: true } });
    const wanted = subscriptions.filter((s) => subscriptionWants(s.events, type));
    if (wanted.length === 0) return [];
    return this.createDeliveries(wanted.map((s) => s.id), type, data);
  }

  /** Envia um evento a UMA subscrição, queira-o ela ou não (botão «Enviar teste»). */
  enqueueFor(subscriptionId: string, type: string, data: unknown) {
    return this.createDeliveries([subscriptionId], type, data);
  }

  private async createDeliveries(subscriptionIds: string[], type: string, data: unknown) {
    const envelope = buildEnvelope(type, data);
    const created = await this.prisma.$transaction(
      subscriptionIds.map((subscriptionId) =>
        this.prisma.webhookDelivery.create({
          data: { subscriptionId, eventId: envelope.id, eventType: type, payload: envelope as unknown as Prisma.InputJsonValue },
          select: { id: true },
        }),
      ),
    );
    const ids = created.map((d) => d.id);
    // Primeira tentativa imediata, fora do pedido que originou o evento (nunca o atrasa nem o faz falhar).
    setImmediate(() => void this.attemptMany(ids));
    return ids;
  }

  /** Agendador: pega nas entregas pendentes cuja hora chegou. */
  @Cron("*/30 * * * * *")
  async processDue(): Promise<number> {
    if (this.sweeping) return 0; // uma só passagem de cada vez
    this.sweeping = true;
    try {
      const now = new Date();
      const due = await this.prisma.webhookDelivery.findMany({
        where: { status: "PENDING", nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        orderBy: { nextAttemptAt: "asc" },
        take: BATCH,
        select: { id: true },
      });
      await this.attemptMany(due.map((d) => d.id));
      return due.length;
    } catch (err) {
      this.logger.error(`Falha ao processar a fila de webhooks: ${(err as Error).message}`);
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  private async attemptMany(ids: string[]) {
    for (const id of ids) {
      try {
        await this.attempt(id);
      } catch (err) {
        this.logger.error(`Falha inesperada na entrega ${id}: ${(err as Error).message}`);
      }
    }
  }

  /** Uma tentativa de envio. Devolve false se a entrega não estava disponível (já enviada ou reservada por outro). */
  async attempt(id: string): Promise<boolean> {
    const now = new Date();
    // Reserva atómica: só um dos concorrentes (tentativa imediata, agendador, reenvio) fica com a entrega.
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: { id, status: "PENDING", OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
    });
    if (claimed.count === 0) return false;

    const delivery = await this.prisma.webhookDelivery.findUniqueOrThrow({ where: { id }, include: { subscription: true } });
    const { subscription } = delivery;

    if (!subscription.active) {
      await this.prisma.webhookDelivery.update({
        where: { id },
        data: { status: "FAILED", lockedUntil: null, lastError: "Subscrição desativada" },
      });
      return true;
    }

    const outcome = await this.send(subscription.url, subscription.secret, delivery.id, delivery.eventType, delivery.payload);
    const attempts = delivery.attempts + 1;

    if (outcome.ok) {
      await this.prisma.$transaction([
        this.prisma.webhookDelivery.update({
          where: { id },
          data: { status: "DELIVERED", attempts, deliveredAt: new Date(), lastStatusCode: outcome.status, lastError: null, lockedUntil: null },
        }),
        this.prisma.webhookSubscription.update({
          where: { id: subscription.id },
          data: { consecutiveFailures: 0, lastSuccessAt: new Date() },
        }),
      ]);
      return true;
    }

    const delay = nextAttemptDelayMs(attempts);
    const failures = subscription.consecutiveFailures + 1;
    const trip = failures >= CIRCUIT_BREAKER_THRESHOLD;
    await this.prisma.$transaction([
      this.prisma.webhookDelivery.update({
        where: { id },
        data: {
          status: delay === null ? "FAILED" : "PENDING",
          attempts,
          nextAttemptAt: delay === null ? delivery.nextAttemptAt : new Date(Date.now() + delay),
          lastStatusCode: outcome.status ?? null,
          lastError: outcome.error,
          lockedUntil: null,
        },
      }),
      this.prisma.webhookSubscription.update({
        where: { id: subscription.id },
        data: {
          consecutiveFailures: failures,
          lastFailureAt: new Date(),
          ...(trip ? { active: false, disabledReason: `Desativada automaticamente após ${failures} falhas seguidas` } : {}),
        },
      }),
    ]);
    if (trip) {
      this.logger.warn(`Webhook "${subscription.name}" desativado automaticamente após ${failures} falhas seguidas`);
      await this.audit.record({ action: "webhook.auto_disabled", targetType: "webhook", targetId: subscription.id, metadata: { failures } });
    }
    return true;
  }

  private async send(url: string, storedSecret: string, deliveryId: string, eventType: string, payload: unknown) {
    try {
      const secret = this.secrets.decrypt(storedSecret, WEBHOOK_SECRET_CONTEXT);
      const body = JSON.stringify(payload);
      const response = await axios.post(url, body, {
        timeout: DELIVERY_TIMEOUT_MS,
        maxRedirects: 0, // um destino não pode reencaminhar o evento (e a assinatura) para outro sítio
        validateStatus: () => true,
        responseType: "text",
        transformRequest: [(data) => data], // envia exatamente os bytes que foram assinados
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "OpenCRM-Webhooks/1",
          "X-OpenCRM-Event": eventType,
          "X-OpenCRM-Delivery": deliveryId,
          "X-OpenCRM-Signature": signPayload(secret, body, Math.floor(Date.now() / 1000)),
        },
      });
      const ok = response.status >= 200 && response.status < 300;
      // Nunca se guarda o corpo da resposta do destino: só o estado.
      return { ok, status: response.status, error: ok ? null : `HTTP ${response.status}` };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return { ok: false, status: undefined, error: (e.code ?? e.message ?? "erro desconhecido").slice(0, 200) };
    }
  }
}
