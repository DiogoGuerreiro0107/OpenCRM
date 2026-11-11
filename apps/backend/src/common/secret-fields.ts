/**
 * Campos da base de dados que guardam segredos de integrações e por isso ficam CIFRADOS em repouso
 * (formato `Tabela.campo`, que é também o "contexto" da cifra — ver secrets.ts).
 *
 * Um teste estrutural (secret-fields.spec.ts) percorre o schema Prisma e falha se aparecer um campo com nome de
 * segredo que não esteja aqui nem em SECRET_FIELD_EXCEPTIONS.
 */
export const SECRET_FIELDS = [
  { model: "EmailAccount", field: "password", table: "EmailAccount" },
  { model: "ZadarmaAccount", field: "apiSecret", table: "ZadarmaAccount" },
] as const;

export const secretContext = (model: string, field: string) => `${model}.${field}`;

/** Campos com nome de segredo que NÃO precisam de cifra, com o motivo. */
export const SECRET_FIELD_EXCEPTIONS: Record<string, string> = {
  "User.passwordHash": "hash bcrypt de uma password de pessoa",
  "User.refreshToken": "guarda o hash bcrypt do refresh token, nunca o token",
  "User.resetTokenHash": "SHA-256 de um token aleatório de 256 bits",
  "User.resetTokenExpiresAt": "data de expiração do pedido de recuperação, não é um segredo",
  "ZadarmaAccount.apiKey": "identificador público da conta, não é o segredo (esse é o apiSecret)",
};
