import { api } from "./api";

export type ModuleId = "leads" | "deals" | "email" | "zadarma" | "automations";

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
