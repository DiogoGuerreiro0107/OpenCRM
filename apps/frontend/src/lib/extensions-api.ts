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

/** Extensões instaladas da pasta `extensions/` (Fase E1.4). */
export type InstalledStatus = "pending" | "changed" | "enabled" | "disabled" | "disabled_auto" | "missing";

export interface InstalledExtensionView {
  id: string;
  name: string;
  description: string;
  version: string;
  status: InstalledStatus;
  /** Impressão digital atual dos ficheiros (SHA-256). */
  checksum: string;
  approvedChecksum: string | null;
  approvedAt: string | null;
  approvedBy: { id: string; name: string } | null;
  server: string | null;
  dependsOn: Record<string, string>;
  permissions: Array<{ permission: string; description: string }>;
  hasSettings: boolean;
  subscriptions: string[];
  consecutiveFailures: number;
  lastError: string | null;
  disabledReason: string | null;
}

export interface InstalledExtensionsList {
  directory: string;
  extensions: InstalledExtensionView[];
  problems: Array<{ folder: string; errors: string[] }>;
}

export const listInstalledExtensions = async () => (await api.get<InstalledExtensionsList>("/extensions/installed")).data;
export const rescanExtensions = async () => (await api.post<InstalledExtensionsList>("/extensions/installed/rescan")).data;
export const approveExtension = async (id: string, checksum: string) => (await api.post<InstalledExtensionView>(`/extensions/installed/${id}/approve`, { checksum })).data;
export const enableExtension = async (id: string) => (await api.post<InstalledExtensionView>(`/extensions/installed/${id}/enable`)).data;
export const disableExtension = async (id: string) => (await api.post<InstalledExtensionView>(`/extensions/installed/${id}/disable`)).data;
export const listExtensionAlerts = async () => (await api.get<Array<{ id: string; name: string; reason: string }>>("/extensions/installed/alerts")).data;
