import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { WebhookDispatcher } from "./webhook-dispatcher.service";

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

  constructor(
    private readonly config: ConfigService,
    private readonly dispatcher: WebhookDispatcher,
  ) {}

  trigger(event: string, payload: Record<string, unknown>) {
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
