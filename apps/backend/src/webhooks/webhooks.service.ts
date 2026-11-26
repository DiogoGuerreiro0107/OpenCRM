import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { WebhookDispatcher } from "./webhook-dispatcher.service";
import { buildEnvelope, WebhookEnvelope } from "./webhook-core";

/**
 * Ponto único de publicação de eventos do CRM para fora. `trigger()` nunca lança nem atrasa quem o chama: uma falha
 * num destino (ou a falta de configuração) não pode impedir a operação principal de ter sucesso.
 *
 * Faz duas coisas (docs/plano-e0-api-publica.md, pacote E0d):
 *  1. LEGADO: envia para `N8N_WEBHOOK_URL`, tal como sempre (sem assinatura nem repetição). Mantido por
 *     compatibilidade; o caminho recomendado é uma subscrição de webhook.
 *  2. Cria uma entrega, assinada e com repetição, por cada subscrição de webhook que queira o evento.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  /** Subscritores internos (Fase E1.4: as extensões instaladas). */
  private readonly listeners: Array<(envelope: WebhookEnvelope) => void> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  /**
   * Subscreve TODOS os eventos dentro do backend (Fase E1.4). Cada um chega em segundo plano, com o envelope dos
   * webhooks; o subscritor apanha os seus erros (um que lance só fica no registo).
   */
  subscribe(listener: (envelope: WebhookEnvelope) => void) {
    this.listeners.push(listener);
  }

  trigger(event: string, payload: Record<string, unknown>) {
    if (this.listeners.length) {
      const envelope = buildEnvelope(event, payload);
      for (const listener of this.listeners) {
        setImmediate(() => {
          try {
            listener(envelope);
          } catch (err) {
            this.logger.error(`Subscritor interno do evento '${event}': ${(err as Error).message}`);
          }
        });
      }
    }

    this.dispatcher.enqueue(event, payload).catch((err: Error) => {
      this.logger.error(`Falha ao pôr o evento '${event}' na fila de webhooks: ${err.message}`);
    });

    const url = this.config.get<string>("N8N_WEBHOOK_URL");
    if (!url) return;

    axios
      .post(url, { event, payload, triggeredAt: new Date().toISOString() }, { timeout: 5000 })
      .catch((err: Error) => {
        this.logger.warn(`Falha ao disparar webhook '${event}': ${err.message}`);
      });
  }
}
