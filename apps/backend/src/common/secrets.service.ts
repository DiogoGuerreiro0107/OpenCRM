import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { decryptSecret, deriveKey, encryptSecret, isEncrypted, secretsKeyProblem, DecryptResult } from "./secrets";

/**
 * Cifra/decifra segredos guardados na base de dados. A chave vem do ambiente (`SECRETS_KEY`, e opcionalmente
 * `SECRETS_KEY_PREVIOUS` durante uma rotação) e nunca da base de dados.
 *
 * Em produção a aplicação recusa arrancar sem chave válida (ver security.ts); fora de produção só falha quando
 * alguém tenta usar um segredo, com uma mensagem a dizer o que configurar.
 */
@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);
  private readonly legacyWarned = new Set<string>();
  private keys: Buffer[] | null = null;

  constructor(private readonly config: ConfigService) {}

  private getKeys(): Buffer[] {
    if (this.keys) return this.keys;
    const current = this.config.get<string>("SECRETS_KEY");
    const problem = secretsKeyProblem(current);
    if (problem) throw new Error(`${problem}. Ver docs/plano-e0-api-publica.md.`);

    const keys = [deriveKey(current!)];
    const previous = this.config.get<string>("SECRETS_KEY_PREVIOUS");
    if (previous) {
      const previousProblem = secretsKeyProblem(previous);
      if (previousProblem) throw new Error(`SECRETS_KEY_PREVIOUS inválida: ${previousProblem}`);
      keys.push(deriveKey(previous));
    }
    this.keys = keys;
    return keys;
  }

  /** Cifra `plain` para guardar. `context` = `Tabela.campo`. */
  encrypt(plain: string, context: string): string {
    return encryptSecret(plain, this.getKeys()[0], context);
  }

  /** Decifra para usar. Valores em claro (legado) são devolvidos tal como estão, com um aviso por campo. */
  decrypt(stored: string, context: string): string {
    return this.decryptDetailed(stored, context).value;
  }

  decryptDetailed(stored: string, context: string): DecryptResult {
    const result = decryptSecret(stored, this.getKeys(), context);
    if (result.legacy && !this.legacyWarned.has(context)) {
      this.legacyWarned.add(context);
      this.logger.warn(
        `${context} está guardado em claro. Corre "node dist/cli/encrypt-secrets.js" (ou "pnpm --filter backend secrets:encrypt") para o cifrar.`,
      );
    }
    return result;
  }

  isEncrypted(stored: string): boolean {
    return isEncrypted(stored);
  }
}
