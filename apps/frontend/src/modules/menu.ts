import type { LucideIcon } from "lucide-react";
import type { MenuEntry } from "@opencrm/shared-types";

/**
 * Junção do menu principal (Fase 2c): os itens que este utilizador pode ver, pela ordem por omissão, com as preferências
 * do Administrador por cima. Funções puras (sem React), para se poderem verificar à parte.
 */

export interface MenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
}

export interface MenuSection {
  /** Cabeçalho do grupo; `null` = itens sem grupo. */
  group: { id: string; label: string } | null;
  items: MenuItem[];
}

/**
 * Regras:
 *  - as entradas dão a ordem; um item renomeado mostra o nome dado; um item oculto não aparece;
 *  - um cabeçalho de grupo abre um grupo com os itens que vêm a seguir (até ao próximo cabeçalho);
 *  - entradas de itens que este utilizador não vê (módulo desligado, sem permissão, tipo que já não existe) ignoram-se;
 *  - itens visíveis que ainda não estão nas preferências (de um módulo ou tipo novo) aparecem no fim, sem grupo;
 *  - grupos que ficam sem itens não aparecem.
 */
export function buildMainMenu(available: MenuItem[], entries: MenuEntry[]): MenuSection[] {
  const byId = new Map(available.map((item) => [item.id, item]));
  const placed = new Set<string>();
  const sections: MenuSection[] = [{ group: null, items: [] }];

  for (const entry of entries) {
    if (entry.type === "group") {
      sections.push({ group: { id: entry.id, label: entry.label }, items: [] });
      continue;
    }
    if (placed.has(entry.id)) continue;
    placed.add(entry.id);
    const item = byId.get(entry.id);
    if (!item || entry.hidden) continue;
    sections[sections.length - 1].items.push(entry.label ? { ...item, label: entry.label } : item);
  }

  const rest = available.filter((item) => !placed.has(item.id));
  if (rest.length > 0) {
    // Sem grupo: se o último bloco for um grupo, os novos não devem cair dentro dele.
    const last = sections[sections.length - 1];
    if (last.group === null) last.items.push(...rest);
    else sections.push({ group: null, items: rest });
  }

  return sections.filter((section) => section.items.length > 0);
}

/** Linha do editor do menu (Configurações > Menu). */
export type EditorRow =
  | { type: "item"; id: string; label: string; defaultLabel: string; hidden: boolean; available: boolean }
  | { type: "group"; id: string; label: string };

/**
 * Lista do editor: as entradas gravadas (mantendo as de itens que agora não estão disponíveis, para não se perder a
 * posição deles ao gravar com um módulo desligado) seguidas dos itens disponíveis que ainda não estão lá.
 * `known` = todos os itens que o menu pode ter neste momento, com o nome por omissão.
 */
export function editorRows(known: Array<{ id: string; label: string }>, entries: MenuEntry[]): EditorRow[] {
  const byId = new Map(known.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const rows: EditorRow[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (entry.type === "group") {
      rows.push({ type: "group", id: entry.id, label: entry.label });
      continue;
    }
    const item = byId.get(entry.id);
    rows.push({ type: "item", id: entry.id, label: entry.label ?? "", defaultLabel: item?.label ?? entry.id, hidden: !!entry.hidden, available: !!item });
  }
  for (const item of known) {
    if (!seen.has(item.id)) rows.push({ type: "item", id: item.id, label: "", defaultLabel: item.label, hidden: false, available: true });
  }
  return rows;
}

/** Entradas a gravar a partir das linhas do editor (nome vazio = nome por omissão). */
export function rowsToEntries(rows: EditorRow[]): MenuEntry[] {
  return rows.map((row) =>
    row.type === "group"
      ? { type: "group", id: row.id, label: row.label.trim() }
      : { type: "item", id: row.id, ...(row.label.trim() ? { label: row.label.trim() } : {}), ...(row.hidden ? { hidden: true } : {}) },
  );
}
