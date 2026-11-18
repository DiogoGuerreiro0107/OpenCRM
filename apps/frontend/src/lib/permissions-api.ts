import type { Role } from "@opencrm/shared-types";
import { api } from "./api";
import type { WriteArea } from "./permissions";

export interface MyPermissions {
  role: Role;
  writeAreas: WriteArea[];
}

export interface PermissionAreaView {
  area: WriteArea;
  label: string;
  description: string;
  roles: Role[];
  defaultRoles: Role[];
  isDefault: boolean;
}

/** As áreas em que o PRÓPRIO utilizador pode escrever. */
export async function getMyPermissions() {
  const { data } = await api.get<MyPermissions>("/me/permissions");
  return data;
}

/** A matriz completa (Administrador). */
export async function listPermissions() {
  const { data } = await api.get<PermissionAreaView[]>("/permissions");
  return data;
}

export async function setPermission(area: WriteArea, roles: Role[]) {
  const { data } = await api.patch<PermissionAreaView[]>(`/permissions/${area}`, { roles });
  return data;
}

export async function resetPermission(area: WriteArea) {
  const { data } = await api.delete<PermissionAreaView[]>(`/permissions/${area}`);
  return data;
}
