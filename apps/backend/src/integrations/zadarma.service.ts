/**
 * Contrato para uma futura integração com a Zadarma (telefonia/PBX).
 * Sem implementação nesta fase — só o contrato.
 */
export interface ZadarmaService {
  /** Inicia uma chamada a partir do CRM (click-to-call). */
  makeCall(phoneNumber: string): Promise<void>;

  /** Vai buscar o histórico de chamadas para associar a contactos/negócios. */
  fetchCallHistory(since?: Date): Promise<unknown[]>;

  /** Regista um webhook da Zadarma para eventos de chamada (recebida, terminada, etc.). */
  registerWebhook(url: string): Promise<void>;
}
