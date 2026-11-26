import { api } from "./api";

export type ModuleId = "leads" | "deals" | "email" | "zadarma" | "automations" | "assistencias" | "produtos" | "stock" | "encomendas" | "compras";

export interface ModuleView {
  id: ModuleId;
  label: string;
  description: string;
  enabled: boolean;
  dependsOn: ModuleId[];
  /** Módulos ATIVOS que dependem deste (se houver, não pode ser desligado). */
  activeDependents: ModuleId[];
}

/** Que módulos estão ativos — qualquer utilizador autenticado. */
export async function getEnabledModules() {
  const { data } = await api.get<{ enabled: ModuleId[] }>("/modules");
  return data.enabled;
}

/** Lista completa com dependências — Administrador. */
export async function listModules() {
  const { data } = await api.get<ModuleView[]>("/modules/manage");
  return data;
}

export async function setModuleEnabled(id: ModuleId, enabled: boolean) {
  const { data } = await api.patch<ModuleView[]>(`/modules/${id}`, { enabled });
  return data;
}

/** Uma extensão (Fase E1.1): por agora os módulos, como extensões embutidas. */
export interface ExtensionView {
  id: string;
  name: string;
  version: string;
  origin: "builtin" | "installed";
  enabled: boolean;
  /** Tem definições (Fase E1.3): formulário gerado a partir do manifesto. */
  hasSettings: boolean;
  /** O que a extensão DECLARA precisar, com a descrição em português. */
  permissions: Array<{ permission: string; description: string }>;
}

/** Extensões com o manifesto e as permissões declaradas — Administrador. */
export async function listExtensions() {
  const { data } = await api.get<ExtensionView[]>("/extensions");
  return data;
}
