import { SetMetadata } from "@nestjs/common";

export const AUDIT_KEY = "audit";

export interface AuditOptions {
  /** Tipo do objeto afetado ("user", "module", "pipeline"...). */
  target?: string;
  /** Parâmetro de rota com o id do objeto (por omissão `id`; se não existir, usa o `id` da resposta). */
  param?: string;
  /**
   * Campos do CORPO do pedido a guardar nos detalhes. Lista branca: o corpo completo nunca é guardado (pode ter
   * passwords). Campos com nome de segredo são removidos mesmo que alguém os liste (ver audit.service.ts).
   */
  fields?: string[];
  /**
   * Grupos de campos cujo VALOR nunca se guarda, só o facto de terem sido enviados: `{ credenciais: ["apiKey",
   * "apiSecret"] }` regista `credenciais: "alteradas"` se algum vier no corpo.
   */
  presence?: Record<string, string[]>;
}

/**
 * Marca uma rota de escrita para ser registada na auditoria quando bem-sucedida. Um teste estrutural
 * (audit-coverage.spec.ts) falha se uma rota de escrita só do Administrador não tiver esta marca nem estiver
 * na lista de exceções: um endpoint novo de administração não fica fora do registo por esquecimento.
 *
 * `action`: identificador estável em minúsculas com ponto (ex.: "user.updated").
 */
export const Audit = (action: string, options: AuditOptions = {}) => SetMetadata(AUDIT_KEY, { action, ...options });
