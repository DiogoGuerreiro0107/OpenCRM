/**
 * Contrato para uma futura integração com o Bitrix24 (o CRM atualmente em
 * uso na Globaltoner). Pensado sobretudo para migração/sincronização de
 * dados de clientes existentes — ver a nota sobre folha de mapeamento de
 * campos em CLAUDE.md, secção 10.
 *
 * Sem implementação nesta fase — só o contrato, para a integração real
 * avançar mais tarde sem redesenhar a fronteira com o resto do backend.
 */
export interface BitrixService {
  /** Sincroniza um contacto do OpenCRM para o Bitrix24 (ou vice-versa). */
  syncContact(contactId: string): Promise<void>;

  /** Vai buscar negócios (deals) do Bitrix24 para eventual importação. */
  fetchDeals(): Promise<unknown[]>;

  /** Vai buscar contactos/empresas do Bitrix24 para eventual importação. */
  fetchContacts(): Promise<unknown[]>;
}
