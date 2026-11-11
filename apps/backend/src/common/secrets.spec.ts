import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  ENCRYPTED_PREFIX,
  hashToken,
  isEncrypted,
  SecretDecryptionError,
  secretsKeyProblem,
} from "./secrets";

const KEY = deriveKey("chave-de-testes-com-pelo-menos-32-caracteres");
const OTHER_KEY = deriveKey("outra-chave-de-testes-com-32-caracteres-ok");
const CTX = "ZadarmaAccount.apiSecret";

describe("encryptSecret / decryptSecret", () => {
  it("ida e volta devolve o valor original (incluindo unicode)", () => {
    for (const plain of ["segredo-simples", "p@ss ção ñ 日本語 🔐", "x".repeat(5000)]) {
      const stored = encryptSecret(plain, KEY, CTX);
      expect(decryptSecret(stored, [KEY], CTX)).toEqual({ value: plain, legacy: false, keyIndex: 0 });
    }
  });

  it("o valor guardado leva o prefixo e não contém o segredo", () => {
    const stored = encryptSecret("super-segredo", KEY, CTX);
    expect(stored.startsWith(ENCRYPTED_PREFIX)).toBe(true);
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain("super-segredo");
  });

  it("o mesmo segredo cifrado duas vezes dá valores diferentes (IV aleatório)", () => {
    expect(encryptSecret("igual", KEY, CTX)).not.toBe(encryptSecret("igual", KEY, CTX));
  });

  it("adulterar um byte falha a decifrar", () => {
    const stored = encryptSecret("segredo", KEY, CTX);
    const raw = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64url");
    raw[raw.length - 1] ^= 0x01;
    const tampered = ENCRYPTED_PREFIX + raw.toString("base64url");
    expect(() => decryptSecret(tampered, [KEY], CTX)).toThrow(SecretDecryptionError);
  });

  it("chave errada falha, e a mensagem nomeia o campo mas nunca o valor", () => {
    const stored = encryptSecret("valor-secreto-xyz", KEY, CTX);
    try {
      decryptSecret(stored, [OTHER_KEY], CTX);
      throw new Error("devia ter falhado");
    } catch (err) {
      expect(err).toBeInstanceOf(SecretDecryptionError);
      expect((err as Error).message).toContain(CTX);
      expect((err as Error).message).not.toContain("valor-secreto-xyz");
      expect((err as Error).message).not.toContain(stored);
    }
  });

  it("contexto diferente falha: um valor cifrado para um campo não decifra noutro", () => {
    const stored = encryptSecret("segredo", KEY, "EmailAccount.password");
    expect(() => decryptSecret(stored, [KEY], "ZadarmaAccount.apiSecret")).toThrow(SecretDecryptionError);
  });

  it("valor truncado ou sem corpo falha com o erro certo", () => {
    expect(() => decryptSecret(`${ENCRYPTED_PREFIX}abc`, [KEY], CTX)).toThrow(SecretDecryptionError);
    expect(() => decryptSecret(ENCRYPTED_PREFIX, [KEY], CTX)).toThrow(SecretDecryptionError);
  });

  it("valor sem prefixo é tratado como legado em claro", () => {
    expect(decryptSecret("password-antiga", [KEY], CTX)).toEqual({ value: "password-antiga", legacy: true, keyIndex: -1 });
  });

  it("rotação: decifra com a chave anterior e indica o índice", () => {
    const stored = encryptSecret("segredo", OTHER_KEY, CTX);
    expect(decryptSecret(stored, [KEY, OTHER_KEY], CTX)).toEqual({ value: "segredo", legacy: false, keyIndex: 1 });
  });
});

describe("secretsKeyProblem", () => {
  it("aceita chaves com 32+ caracteres", () => {
    expect(secretsKeyProblem("x".repeat(32))).toBeNull();
  });
  it("recusa em falta, vazia ou curta", () => {
    expect(secretsKeyProblem(undefined)).toContain("em falta");
    expect(secretsKeyProblem("")).toContain("em falta");
    expect(secretsKeyProblem("curta")).toContain("curta");
  });
  it("a mensagem nunca inclui o valor da chave", () => {
    expect(secretsKeyProblem("valor-muito-secreto")).not.toContain("valor-muito-secreto");
  });
});

describe("deriveKey", () => {
  it("é determinística e devolve 32 bytes", () => {
    const a = deriveKey("mesma-chave-com-mais-de-32-caracteres-ok");
    expect(a.length).toBe(32);
    expect(a.equals(deriveKey("mesma-chave-com-mais-de-32-caracteres-ok"))).toBe(true);
    expect(a.equals(deriveKey("mesma-chave-com-mais-de-32-caracteres-OK"))).toBe(false);
  });
});

describe("hashToken", () => {
  it("é SHA-256 em hexadecimal, determinístico e diferente do token", () => {
    const h = hashToken("token-de-exemplo");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(hashToken("token-de-exemplo"));
    expect(h).not.toContain("token-de-exemplo");
    expect(hashToken("outro")).not.toBe(h);
  });
});
