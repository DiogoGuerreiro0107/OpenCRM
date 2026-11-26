/**
 * O contrato entre o CRM e uma extensão instalada (Fase E1.4, guia em docs/extensoes.md). Versão: `SDK_VERSION` em
 * manifest.ts — o manifesto de uma extensão declara o intervalo que aceita (`"sdk": "^1.0.0"`).
 *
 * Uma extensão é uma pasta com `extension.json` e um ficheiro JavaScript (CommonJS) que exporta `activate`:
 *
 *   module.exports = {
 *     async activate(ctx) {
 *       ctx.events.on("lead.created", async (event) => { ... });
 *       return { deactivate() { ... } };   // opcional
 *     },
 *   };
 *
 * Corre DENTRO do backend, com confiança total (docs/plano-extensoes-e-api.md §9): o contexto é a forma suportada e
 * estável de falar com o CRM, não uma barreira.
 */

export type SettingValue = string | boolean | null;

/** O mesmo envelope dos webhooks (docs/api-publica.md): `data` em snake_case. */
export interface ExtensionEvent {
  id: string;
  type: string;
  version: number;
  occurred_at: string;
  data: unknown;
}

export type EventHandler = (event: ExtensionEvent) => void | Promise<void>;

export interface ExtensionLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ExtensionContext {
  id: string;
  version: string;
  /** As definições declaradas no manifesto, com os valores por omissão e os segredos decifrados. */
  settings: { get(): Promise<Record<string, SettingValue>> };
  /** Estado interno da extensão (JSON pequeno; não são definições e não sai pela API). */
  state: {
    get(): Promise<Record<string, unknown>>;
    /** Junta `patch` ao estado guardado. */
    set(patch: Record<string, unknown>): Promise<void>;
  };
  /** Subscrever um tipo de evento (o catálogo dos webhooks) ou todos com "*". Limite de 10 s por evento. */
  events: { on(type: string, handler: EventHandler): void };
  log: ExtensionLogger;
}

export interface ActivatedExtension {
  deactivate?(): void | Promise<void>;
}

export interface ExtensionModule {
  activate(ctx: ExtensionContext): void | ActivatedExtension | Promise<void | ActivatedExtension>;
}
