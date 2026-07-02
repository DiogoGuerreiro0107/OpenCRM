/**
 * Abstração para provedores transacionais de email (Brevo, Mailgun, SES,
 * etc.), como alternativa ao envio direto por SMTP já implementado na
 * Fase 4 (útil sobretudo para envios em volume/newsletters, com melhor
 * entregabilidade e tracking de abertura/cliques).
 *
 * A integração de email real da Fase 4 (`EmailService`) pode vir a
 * implementar este contrato mais tarde, mas fá-lo-á na revisão final —
 * não foi alterada nesta fase para manter o âmbito só aditivo.
 * Sem implementação nesta fase — só o contrato.
 */
export interface MailProviderService {
  send(message: { to: string[]; subject: string; text: string; html?: string }): Promise<void>;

  /** Valida a assinatura de um webhook de entrega/bounce do provedor. */
  validateWebhookSignature(payload: string, signature: string): boolean;
}
