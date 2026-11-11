import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * Cifra de segredos em repouso (AES-256-GCM). Funções puras: não leem o ambiente nem a base de dados,
 * para serem fáceis de testar e para o `seed` e o comando `secrets:encrypt` as usarem sem Nest.
 * Desenho e decisões: docs/plano-e0-api-publica.md (pacote E0a).
 *
 * Formato guardado: `enc:v1:<base64url(iv[12] ‖ etiqueta[16] ‖ cifrado)>`.
 * Os dados associados (AAD) são o "contexto" (`Tabela.campo`): um valor cifrado para um campo não decifra se
 * for copiado para outro.
 */

export const ENCRYPTED_PREFIX = "enc:v1:";
export const MIN_SECRETS_KEY_LENGTH = 32;

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Falha ao decifrar. A mensagem nomeia o campo mas NUNCA inclui o valor. */
export class SecretDecryptionError extends Error {
  constructor(context: string) {
    super(
      `Não foi possível decifrar ${context}: a chave SECRETS_KEY está errada (ou foi alterada sem SECRETS_KEY_PREVIOUS) ` +
        "ou o valor foi adulterado.",
    );
    this.name = "SecretDecryptionError";
  }
}

/** Problemas com o valor de SECRETS_KEY (vazia = tudo bem). */
export function secretsKeyProblem(value: string | undefined): string | null {
  if (!value) return "SECRETS_KEY em falta";
  if (value.length < MIN_SECRETS_KEY_LENGTH) {
    return `SECRETS_KEY demasiado curta (mínimo ${MIN_SECRETS_KEY_LENGTH} caracteres; gera uma com "openssl rand -base64 32")`;
  }
  return null;
}

/** Deriva a chave AES-256 a partir do texto configurado (HKDF-SHA256, sem sal secreto: a chave é o segredo). */
export function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "opencrm-secrets-v1", "aes-256-gcm", 32));
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSecret(plain: string, key: Buffer, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export interface DecryptResult {
  value: string;
  /** true se o valor guardado NÃO estava cifrado (segredo em claro de antes desta funcionalidade). */
  legacy: boolean;
  /** Índice da chave que decifrou (0 = atual). -1 em legado. */
  keyIndex: number;
}

/**
 * Decifra com a primeira chave que funcionar (atual, depois anteriores). Um valor sem o prefixo é tratado como
 * segredo em claro (legado) e devolvido tal como está.
 */
export function decryptSecret(stored: string, keys: Buffer[], context: string): DecryptResult {
  if (!isEncrypted(stored)) return { value: stored, legacy: true, keyIndex: -1 };

  const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64url");
  if (raw.length < IV_BYTES + TAG_BYTES) throw new SecretDecryptionError(context);
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = raw.subarray(IV_BYTES + TAG_BYTES);

  for (let i = 0; i < keys.length; i++) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", keys[i], iv);
      decipher.setAAD(Buffer.from(context, "utf8"));
      decipher.setAuthTag(tag);
      const value = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
      return { value, legacy: false, keyIndex: i };
    } catch {
      // tenta a chave seguinte
    }
  }
  throw new SecretDecryptionError(context);
}

/**
 * SHA-256 em hexadecimal, para tokens aleatórios de 256 bits (p. ex. recuperação de password): guardar só o
 * hash impede que uma leitura da base de dados revele tokens ainda válidos. Não serve para passwords de pessoas
 * (essas usam bcrypt).
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
