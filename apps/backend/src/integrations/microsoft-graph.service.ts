/**
 * Contrato para uma futura integração com o Microsoft 365 / Outlook via
 * Microsoft Graph (email e calendário, por utilizador).
 * Sem implementação nesta fase — só o contrato.
 */
export interface MicrosoftGraphService {
  /** Envia uma mensagem em nome de um utilizador autenticado via OAuth. */
  sendMessage(userId: string, to: string[], subject: string, body: string): Promise<void>;

  /** Vai buscar mensagens recentes da caixa do utilizador. */
  fetchMessages(userId: string, since?: Date): Promise<unknown[]>;

  /** Vai buscar eventos de calendário do utilizador, para a vista de Tarefas/Calendário. */
  fetchCalendarEvents(userId: string, from: Date, to: Date): Promise<unknown[]>;
}
