/**
 * Cifra os segredos que ainda estão em claro na base de dados e recifra os que estão com a chave anterior.
 * Idempotente: pode correr-se as vezes que for preciso.
 *
 *   pnpm --filter backend secrets:encrypt                  (desenvolvimento)
 *   docker compose exec backend node dist/cli/encrypt-secrets.js   (Docker)
 *
 * Precisa de DATABASE_URL e SECRETS_KEY (e SECRETS_KEY_PREVIOUS se a chave mudou). Imprime só contagens.
 */
import { PrismaClient } from "@prisma/client";
import { deriveKey, secretsKeyProblem } from "../common/secrets";
import { encryptStoredSecrets } from "../common/secrets-migration";

async function main() {
  const problem = secretsKeyProblem(process.env.SECRETS_KEY);
  if (problem) throw new Error(problem);
  const keys = [deriveKey(process.env.SECRETS_KEY!)];
  if (process.env.SECRETS_KEY_PREVIOUS) {
    const previousProblem = secretsKeyProblem(process.env.SECRETS_KEY_PREVIOUS);
    if (previousProblem) throw new Error(`SECRETS_KEY_PREVIOUS inválida: ${previousProblem}`);
    keys.push(deriveKey(process.env.SECRETS_KEY_PREVIOUS));
  }

  const db = new PrismaClient();
  try {
    const reports = await encryptStoredSecrets(db, keys);
    // Ação do sistema (sem utilizador): só contagens, nunca valores.
    await db.auditEvent.create({
      data: { action: "secrets.encrypted", targetType: "secrets", metadata: { resultado: reports.map((r) => ({ campo: r.field, cifrados: r.encrypted, recifrados: r.recrypted, semAlteracao: r.unchanged })) } },
    });
    for (const r of reports) {
      console.log(`${r.field}: ${r.encrypted} cifrado(s), ${r.recrypted} recifrado(s), ${r.unchanged} já estava(m) em ordem`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(`Erro: ${(err as Error).message}`);
  process.exit(1);
});
