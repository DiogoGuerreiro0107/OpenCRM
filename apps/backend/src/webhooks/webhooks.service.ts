import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Dispara um webhook para o n8n de forma assíncrona (fire-and-forget).
   * Nunca lança — uma falha no n8n (ou a ausência de configuração) não pode
   * impedir a operação principal do CRM de ter sucesso.
   */
  trigger(event: string, payload: Record<string, unknown>) {
    const url = this.config.get<string>("N8N_WEBHOOK_URL");
    if (!url) return;

    axios
      .post(url, { event, payload, triggeredAt: new Date().toISOString() }, { timeout: 5000 })
      .catch((err: Error) => {
        this.logger.warn(`Falha ao disparar webhook '${event}': ${err.message}`);
      });
  }
}
