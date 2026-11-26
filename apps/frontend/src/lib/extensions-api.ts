import { api } from "./api";

/** Definições das extensões (Fase E1.3): o núcleo gera o formulário a partir do manifesto. Só Administrador. */
export type SettingType = "text" | "secret" | "select" | "boolean";
export type SettingValue = string | boolean | null;

export interface SettingField {
  key: string;
  label: string;
  description?: string;
  type: SettingType;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  default?: string | boolean;
  maxLength?: number;
}

export interface ExtensionSettingsView {
  extensionId: string;
  fields: SettingField[];
  /** Sem os segredos (esses nunca saem do servidor). */
  values: Record<string, SettingValue>;
  /** Os segredos que estão preenchidos. */
  secretsSet: string[];
}

export const getExtensionSettings = async (id: string) => (await api.get<ExtensionSettingsView>(`/extensions/${id}/settings`)).data;

/** Só os campos alterados. Um segredo omitido fica como está; texto vazio apaga (se não for obrigatório). */
export const updateExtensionSettings = async (id: string, patch: Record<string, SettingValue>) =>
  (await api.patch<ExtensionSettingsView>(`/extensions/${id}/settings`, patch)).data;
