import { Prisma, PrismaClient } from "@prisma/client";
import { decryptSecret, encryptSecret, isEncrypted } from "./secrets";
import { secretContext } from "./secret-fields";
import { MODULE_MANIFESTS } from "../modules/module-manifest";

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
  "WebhookSubscription.secret": {
    list: async (db: PrismaClient): Promise<Row[]> =>
      (await db.webhookSubscription.findMany({ select: { id: true, secret: true } })).map((r) => ({ id: r.id, value: r.secret })),
    save: (db: PrismaClient, id: string, value: string) => db.webhookSubscription.update({ where: { id }, data: { secret: value } }),
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
  reports.push(await encryptSettingSecrets(db, keys));
  reports.push(await encryptInstalledSecrets(db, keys));
  return reports;
}

/** Contexto de um segredo das definições (igual ao de extensions/extension-settings.service.ts). */
const settingContext = (moduleId: string, key: string) => `ModuleSetting.options.${moduleId}.${key}`;

/** Os segredos das definições das extensões (Fase E1.3): um por campo `secret` preenchido de cada módulo. */
async function settingSecrets(db: PrismaClient) {
  const secretFields = MODULE_MANIFESTS.flatMap((m) => (m.settings ?? []).filter((f) => f.type === "secret").map((f) => ({ moduleId: m.id, key: f.key })));
  if (!secretFields.length) return [];
  const rows = await db.moduleSetting.findMany({ where: { moduleId: { in: [...new Set(secretFields.map((f) => f.moduleId))] } }, select: { moduleId: true, options: true } });
  const optionsOf = new Map(rows.map((r) => [r.moduleId, (r.options ?? {}) as Record<string, unknown>]));
  return secretFields.flatMap(({ moduleId, key }) => {
    const value = optionsOf.get(moduleId)?.[key];
    return typeof value === "string" && value !== "" ? [{ moduleId, key, value }] : [];
  });
}

async function encryptSettingSecrets(db: PrismaClient, keys: Buffer[]): Promise<SecretsReport> {
  const report: SecretsReport = { field: "ModuleSetting.options (definições das extensões)", encrypted: 0, recrypted: 0, unchanged: 0 };
  for (const s of await settingSecrets(db)) {
    const context = settingContext(s.moduleId, s.key);
    const decrypted = decryptSecret(s.value, keys, context);
    if (!decrypted.legacy && decrypted.keyIndex === 0) {
      report.unchanged++;
      continue;
    }
    // Relê as opções antes de gravar: só muda este campo.
    const row = await db.moduleSetting.findUniqueOrThrow({ where: { moduleId: s.moduleId }, select: { options: true } });
    const options = { ...((row.options ?? {}) as Record<string, unknown>), [s.key]: encryptSecret(decrypted.value, keys[0], context) };
    await db.moduleSetting.update({ where: { moduleId: s.moduleId }, data: { options: options as Prisma.InputJsonValue } });
    if (decrypted.legacy) report.encrypted++;
    else report.recrypted++;
  }
  return report;
}

/** Quantos segredos ainda estão em claro (para avisar na arrancada). */
export async function countPlaintextSecrets(db: PrismaClient): Promise<number> {
  let total = 0;
  for (const key of ENCRYPTED_FIELD_KEYS) {
    for (const row of await ACCESSORS[key].list(db)) if (!isEncrypted(row.value)) total++;
  }
  for (const s of await settingSecrets(db)) if (!isEncrypted(s.value)) total++;
  for (const s of await installedSecrets(db)) if (!isEncrypted(s.value)) total++;
  return total;
}

/** Contexto de um segredo das definições de uma extensão instalada (igual ao de extension-settings.service.ts). */
const installedContext = (id: string, key: string) => `InstalledExtension.options.${id}.${key}`;

/** Os segredos das definições das extensões instaladas (Fase E1.4): os campos `secret` do manifesto de cada uma. */
async function installedSecrets(db: PrismaClient) {
  const rows = await db.installedExtension.findMany({ select: { id: true, manifest: true, options: true } });
  return rows.flatMap((row) => {
    const fields = ((row.manifest as { settings?: Array<{ key: string; type: string }> }).settings ?? []).filter((f) => f.type === "secret");
    const options = (row.options ?? {}) as Record<string, unknown>;
    return fields.flatMap((f) => (typeof options[f.key] === "string" && options[f.key] !== "" ? [{ id: row.id, key: f.key, value: options[f.key] as string }] : []));
  });
}

async function encryptInstalledSecrets(db: PrismaClient, keys: Buffer[]): Promise<SecretsReport> {
  const report: SecretsReport = { field: "InstalledExtension.options (definições das extensões instaladas)", encrypted: 0, recrypted: 0, unchanged: 0 };
  for (const s of await installedSecrets(db)) {
    const context = installedContext(s.id, s.key);
    const decrypted = decryptSecret(s.value, keys, context);
    if (!decrypted.legacy && decrypted.keyIndex === 0) {
      report.unchanged++;
      continue;
    }
    const row = await db.installedExtension.findUniqueOrThrow({ where: { id: s.id }, select: { options: true } });
    const options = { ...((row.options ?? {}) as Record<string, unknown>), [s.key]: encryptSecret(decrypted.value, keys[0], context) };
    await db.installedExtension.update({ where: { id: s.id }, data: { options: options as Prisma.InputJsonValue } });
    if (decrypted.legacy) report.encrypted++;
    else report.recrypted++;
  }
  return report;
}
