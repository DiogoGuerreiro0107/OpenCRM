/**
 * Contrato para uma futura integração direta com o Gmail (OAuth, por
 * utilizador) como alternativa/complemento à caixa partilhada IMAP/SMTP
 * já implementada na Fase 4.
 * Sem implementação nesta fase — só o contrato.
 */
export interface GmailService {
  /** Envia uma mensagem em nome de um utilizador autenticado via OAuth. */
  sendMessage(userId: string, to: string[], subject: string, body: string): Promise<void>;

  /** Vai buscar mensagens recentes da caixa do utilizador. */
  fetchMessages(userId: string, since?: Date): Promise<unknown[]>;
}
