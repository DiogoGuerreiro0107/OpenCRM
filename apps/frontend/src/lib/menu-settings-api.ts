import type { MenuEntry, MenuSettings } from "@opencrm/shared-types";
import { api } from "./api";

/** Preferências do menu principal (Fase 2c). Todos leem; só o Administrador grava. */
export async function getMenuSettings() {
  const { data } = await api.get<MenuSettings>("/menu-settings");
  return data;
}

/** Lista vazia = repor o menu por omissão. */
export async function saveMenuSettings(entries: MenuEntry[]) {
  const { data } = await api.put<MenuSettings>("/menu-settings", { entries });
  return data;
}
