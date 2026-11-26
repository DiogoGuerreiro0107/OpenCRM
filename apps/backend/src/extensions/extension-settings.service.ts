import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { isModuleId, ModuleId } from "../modules/module-manifest";
import { SecretsService } from "../common/secrets.service";
import { AuditService } from "../audit/audit.service";
import { BUILTIN_EXTENSIONS } from "./builtin";
import { ExtensionManifest } from "./manifest";
import { effectiveValue, SettingField, SettingValue, validateSettingsPatch } from "./settings";

/** Contexto da cifra de um segredo das definições: um valor nunca decifra noutra extensão nem noutro campo. */
export const settingSecretContext = (extensionId: string, key: string) => `ModuleSetting.options.${extensionId}.${key}`;
/** O mesmo, para as extensões instaladas (Fase E1.4), guardadas noutra tabela. */
export const installedSecretContext = (extensionId: string, key: string) => `InstalledExtension.options.${extensionId}.${key}`;

/** Onde ficam as definições de uma extensão: embutida (opções do módulo) ou instalada (a sua linha). */
interface Target {
  id: string;
  fields: SettingField[];
  read(): Promise<Record<string, unknown>>;
  write(patch: Record<string, unknown>): Promise<void>;
  context(key: string): string;
}

/**
 * Definições das extensões (Fase E1.3, docs/plano-fase-e1-extensoes.md). Embutidas: nas opções do módulo; instaladas
 * (E1.4): na própria linha. Os segredos cifrados e nunca devolvidos pela API (só se estão preenchidos).
 */
@Injectable()
export class ExtensionSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly secrets: SecretsService,
    private readonly audit: AuditService,
  ) {}

  private builtinFields(id: string): { id: ModuleId; fields: SettingField[] } | null {
    const manifest = BUILTIN_EXTENSIONS.find((m) => m.id === id);
    return manifest && isModuleId(id) ? { id, fields: manifest.settings } : null;
  }

  private async target(id: string): Promise<Target> {
    const builtin = this.builtinFields(id);
    if (builtin) {
      return {
        id: builtin.id,
        fields: builtin.fields,
        read: async () => this.modules.getOptions(builtin.id),
        write: async (patch) => void (await this.modules.setOptions(builtin.id, patch)),
        context: (key) => settingSecretContext(builtin.id, key),
      };
    }
    const row = await this.prisma.installedExtension.findUnique({ where: { id }, select: { id: true, manifest: true } });
    if (!row) throw new NotFoundException("Extensão não encontrada");
    const read = async () =>
      ((await this.prisma.installedExtension.findUniqueOrThrow({ where: { id }, select: { options: true } })).options ?? {}) as Record<string, unknown>;
    return {
      id,
      fields: (row.manifest as unknown as ExtensionManifest).settings ?? [],
      read,
      write: async (patch) => {
        const merged = { ...(await read()), ...patch } as Prisma.InputJsonValue;
        await this.prisma.installedExtension.update({ where: { id }, data: { options: merged } });
      },
      context: (key) => installedSecretContext(id, key),
    };
  }

  private decode(fields: SettingField[], stored: Record<string, unknown>, context: (key: string) => string) {
    const values: Record<string, SettingValue> = {};
    for (const field of fields) {
      if (field.type === "secret") {
        const raw = stored[field.key];
        values[field.key] = typeof raw === "string" && raw !== "" ? this.secrets.decrypt(raw, context(field.key)) : null;
      } else values[field.key] = effectiveValue(field, stored[field.key]);
    }
    return values;
  }

  /** Para o código de uma extensão embutida (síncrono: as opções estão em memória). Segredos decifrados. */
  get(id: ModuleId): Record<string, SettingValue> {
    const builtin = this.builtinFields(id);
    if (!builtin) throw new NotFoundException("Extensão não encontrada");
    return this.decode(builtin.fields, this.modules.getOptions(builtin.id), (key) => settingSecretContext(builtin.id, key));
  }

  /** Para qualquer extensão (o contexto das instaladas, E1.4). Segredos decifrados. */
  async getFor(id: string): Promise<Record<string, SettingValue>> {
    const t = await this.target(id);
    return this.decode(t.fields, await t.read(), t.context);
  }

  /** Para a página: os campos, os valores (sem os segredos) e que segredos estão preenchidos. */
  async view(id: string) {
    const t = await this.target(id);
    const stored = await t.read();
    const values: Record<string, SettingValue> = {};
    const secretsSet: string[] = [];
    for (const field of t.fields) {
      if (field.type === "secret") {
        if (typeof stored[field.key] === "string" && stored[field.key] !== "") secretsSet.push(field.key);
      } else values[field.key] = effectiveValue(field, stored[field.key]);
    }
    return { extensionId: t.id, fields: t.fields, values, secretsSet };
  }

  /** Grava as alterações (validadas contra o manifesto), cifra os segredos e regista na auditoria só os nomes. */
  async update(id: string, patch: unknown, actorId: string | null) {
    const t = await this.target(id);
    if (t.fields.length === 0) throw new BadRequestException("Esta extensão não tem definições");
    const stored = await t.read();
    const { changes, errors } = validateSettingsPatch(t.fields, patch, stored);
    if (errors.length) throw new BadRequestException(errors);
    const toSave: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const field of t.fields) {
      if (!Object.prototype.hasOwnProperty.call(changes, field.key)) continue;
      const value = changes[field.key];
      if (field.type === "secret") {
        toSave[field.key] = typeof value === "string" ? this.secrets.encrypt(value, t.context(field.key)) : null;
        changed.push(field.key);
      } else if (value !== effectiveValue(field, stored[field.key]) || !(field.key in stored)) {
        toSave[field.key] = value;
        if (value !== effectiveValue(field, stored[field.key])) changed.push(field.key);
      }
    }
    if (Object.keys(toSave).length) await t.write(toSave);
    if (changed.length) {
      await this.audit.record({ action: "extension.settings_updated", actorId, targetType: "extension", targetId: t.id, metadata: { changed } });
    }
    return this.view(t.id);
  }
}
