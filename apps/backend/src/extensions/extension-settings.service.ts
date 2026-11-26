import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ModulesService } from "../modules/modules.service";
import { isModuleId, ModuleId } from "../modules/module-manifest";
import { SecretsService } from "../common/secrets.service";
import { AuditService } from "../audit/audit.service";
import { BUILTIN_EXTENSIONS } from "./builtin";
import { effectiveValue, SettingField, SettingValue, validateSettingsPatch } from "./settings";

/** Contexto da cifra de um segredo das definições: um valor nunca decifra noutra extensão nem noutro campo. */
export const settingSecretContext = (extensionId: string, key: string) => `ModuleSetting.options.${extensionId}.${key}`;

/**
 * Definições das extensões (Fase E1.3, docs/plano-fase-e1-extensoes.md). Guardadas nas opções do módulo; os segredos
 * cifrados e nunca devolvidos pela API (só se estão preenchidos).
 */
@Injectable()
export class ExtensionSettingsService {
  constructor(
    private readonly modules: ModulesService,
    private readonly secrets: SecretsService,
    private readonly audit: AuditService,
  ) {}

  private fieldsOf(id: string): { id: ModuleId; fields: SettingField[] } {
    const manifest = BUILTIN_EXTENSIONS.find((m) => m.id === id);
    if (!manifest || !isModuleId(id)) throw new NotFoundException("Extensão não encontrada");
    return { id, fields: manifest.settings };
  }

  /** Para o código da extensão: os valores com os por omissão, e os segredos decifrados (null se vazios). */
  get(id: ModuleId): Record<string, SettingValue> {
    const { fields } = this.fieldsOf(id);
    const stored = this.modules.getOptions(id);
    const values: Record<string, SettingValue> = {};
    for (const field of fields) {
      if (field.type === "secret") {
        const raw = stored[field.key];
        values[field.key] = typeof raw === "string" && raw !== "" ? this.secrets.decrypt(raw, settingSecretContext(id, field.key)) : null;
      } else values[field.key] = effectiveValue(field, stored[field.key]);
    }
    return values;
  }

  /** Para a página: os campos, os valores (sem os segredos) e que segredos estão preenchidos. */
  view(id: string) {
    const { id: moduleId, fields } = this.fieldsOf(id);
    const stored = this.modules.getOptions(moduleId);
    const values: Record<string, SettingValue> = {};
    const secretsSet: string[] = [];
    for (const field of fields) {
      if (field.type === "secret") {
        if (typeof stored[field.key] === "string" && stored[field.key] !== "") secretsSet.push(field.key);
      } else values[field.key] = effectiveValue(field, stored[field.key]);
    }
    return { extensionId: moduleId, fields, values, secretsSet };
  }

  /** Grava as alterações (validadas contra o manifesto), cifra os segredos e regista na auditoria só os nomes. */
  async update(id: string, patch: unknown, actorId: string | null) {
    const { id: moduleId, fields } = this.fieldsOf(id);
    if (fields.length === 0) throw new BadRequestException("Esta extensão não tem definições");
    const stored = this.modules.getOptions(moduleId);
    const { changes, errors } = validateSettingsPatch(fields, patch, stored);
    if (errors.length) throw new BadRequestException(errors);
    const toSave: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(changes, field.key)) continue;
      const value = changes[field.key];
      if (field.type === "secret") {
        toSave[field.key] = typeof value === "string" ? this.secrets.encrypt(value, settingSecretContext(moduleId, field.key)) : null;
        changed.push(field.key);
      } else if (value !== effectiveValue(field, stored[field.key]) || !(field.key in stored)) {
        toSave[field.key] = value;
        if (value !== effectiveValue(field, stored[field.key])) changed.push(field.key);
      }
    }
    if (Object.keys(toSave).length) await this.modules.setOptions(moduleId, toSave);
    if (changed.length) {
      await this.audit.record({ action: "extension.settings_updated", actorId, targetType: "extension", targetId: moduleId, metadata: { changed } });
    }
    return this.view(moduleId);
  }
}
