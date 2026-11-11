import { PrismaClient } from "@prisma/client";
import { decryptSecret, encryptSecret, isEncrypted } from "./secrets";
import { secretContext } from "./secret-fields";

/** Quantos valores ficaram em cada situação (por campo, só contagens, nunca valores). */
export interface SecretsReport {
  field: string;
  encrypted: number; // estavam em claro e foram cifrados
  recrypted: number; // estavam cifrados com a chave anterior e foram recifrados com a atual
  unchanged: number; // já cifrados com a chave atual
}

type Row = { id: string; value: string };

/** Acesso por campo, escrito à mão (um `switch` tipado em vez de acesso dinâmico ao Prisma). */
const ACCESSORS = {
  "EmailAccount.password": {
    list: async (db: PrismaClient): Promise<Row[]> =>
      (await db.emailAccount.findMany({ select: { id: true, password: true } })).map((r) => ({ id: r.id, value: r.password })),
    save: (db: PrismaClient, id: string, value: string) => db.emailAccount.update({ where: { id }, data: { password: value } }),
  },
  "ZadarmaAccount.apiSecret": {
    list: async (db: PrismaClient): Promise<Row[]> =>
      (await db.zadarmaAccount.findMany({ select: { id: true, apiSecret: true } })).map((r) => ({ id: r.id, value: r.apiSecret })),
    save: (db: PrismaClient, id: string, value: string) => db.zadarmaAccount.update({ where: { id }, data: { apiSecret: value } }),
  },
} as const;

type FieldKey = keyof typeof ACCESSORS;

export const ENCRYPTED_FIELD_KEYS = Object.keys(ACCESSORS) as FieldKey[];

/**
 * Cifra o que está em claro e recifra o que está cifrado com uma chave anterior. Idempotente.
 * Decifra SEMPRE primeiro: se a chave estiver errada falha antes de gravar o que quer que seja nesse registo.
 * `keys[0]` é a chave atual.
 */
export async function encryptStoredSecrets(db: PrismaClient, keys: Buffer[]): Promise<SecretsReport[]> {
  const reports: SecretsReport[] = [];
  for (const key of ENCRYPTED_FIELD_KEYS) {
    const accessor = ACCESSORS[key];
    const report: SecretsReport = { field: key, encrypted: 0, recrypted: 0, unchanged: 0 };
    for (const row of await accessor.list(db)) {
      const decrypted = decryptSecret(row.value, keys, secretContext(...(key.split(".") as [string, string])));
      if (decrypted.legacy) {
        await accessor.save(db, row.id, encryptSecret(decrypted.value, keys[0], key));
        report.encrypted++;
      } else if (decrypted.keyIndex > 0) {
        await accessor.save(db, row.id, encryptSecret(decrypted.value, keys[0], key));
        report.recrypted++;
      } else {
        report.unchanged++;
      }
    }
    reports.push(report);
  }
  return reports;
}

/** Quantos segredos ainda estão em claro (para avisar na arrancada). */
export async function countPlaintextSecrets(db: PrismaClient): Promise<number> {
  let total = 0;
  for (const key of ENCRYPTED_FIELD_KEYS) {
    for (const row of await ACCESSORS[key].list(db)) if (!isEncrypted(row.value)) total++;
  }
  return total;
}
