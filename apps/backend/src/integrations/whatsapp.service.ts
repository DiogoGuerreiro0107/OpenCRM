/**
 * Contrato para uma futura integração com o WhatsApp, previsivelmente via
 * o WAHA (WhatsApp HTTP API) já usado com o n8n existente na Globaltoner
 * — ver CLAUDE.md, secção 3 ("Nota sobre automações").
 * Sem implementação nesta fase — só o contrato.
 */
export interface WhatsAppService {
  sendMessage(phoneNumber: string, message: string): Promise<void>;

  fetchMessages(phoneNumber: string, since?: Date): Promise<unknown[]>;
}
