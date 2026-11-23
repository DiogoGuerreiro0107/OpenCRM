import { Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { hasRole } from "@/lib/permissions";
import { useMyPermissions } from "@/lib/useCanWrite";
import { useModules } from "@/lib/useModules";
import { getMenuSettings } from "@/lib/menu-settings-api";
import { listWorkItemTypes } from "@/lib/work-item-types-api";
import { workItemIcon } from "@/components/WorkItemTypeBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_CONTRIBUTIONS, recordPanelsFor } from "./registry";
import { buildMainMenu, type MenuItem } from "./menu";
import type { RecordEntity, RecordPanelProps, Visibility } from "./types";

/**
 * Se este utilizador vê uma contribuição: módulo ativo e (papel OU área de escrita, quando os há). Enquanto os módulos
 * carregam, nenhum módulo opcional conta como ativo (os itens não piscam).
 */
export function useCanSee() {
  const { user } = useAuth();
  const { enabled } = useModules();
  const { data: permissions } = useMyPermissions();
  return (v: Visibility) => {
    if (v.module && !enabled.has(v.module)) return false;
    if (v.writeArea) return !!permissions?.writeAreas.includes(v.writeArea);
    if (v.roles) return hasRole(user?.role, v.roles);
    return true;
  };
}

/** Ordem por omissão dos tipos de tarefa no menu: logo a seguir a «Tarefas» (ordem 30), pela ordem dos tipos. */
const TYPE_ITEMS_ORDER = 31;

/**
 * Itens do menu principal que este utilizador pode ver, pela ordem por omissão: os dos módulos e os dos tipos de
 * tarefa com «aparece no menu» (ativos).
 */
export function useMainMenuItems(): MenuItem[] {
  const canSee = useCanSee();
  const { data: types = [] } = useQuery({ queryKey: ["work-item-types", "all"], queryFn: () => listWorkItemTypes() });
  const fromModules = NAV_CONTRIBUTIONS.filter((n) => n.section === "main" && canSee(n)).map((n) => ({ order: n.order, item: { id: n.id, label: n.label, icon: n.icon, to: n.to } }));
  const fromTypes = types
    .filter((t) => t.showInMenu && t.active)
    .map((t, i) => ({ order: TYPE_ITEMS_ORDER + i / 1000, item: { id: `work-item-type:${t.id}`, label: t.name, icon: workItemIcon(t.icon), to: `/tarefas/tipo/${encodeURIComponent(t.id)}` } }));
  return [...fromModules, ...fromTypes].sort((a, b) => a.order - b.order).map((x) => x.item);
}

export function useMenuSettings() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["menu-settings"], queryFn: getMenuSettings, enabled: !!user, staleTime: 60_000 });
}

/** Menu principal deste utilizador, com as preferências do Administrador. */
export function useMainMenu() {
  const items = useMainMenuItems();
  const { data } = useMenuSettings();
  return buildMainMenu(items, data?.entries ?? []);
}

/** Itens das configurações (fixos) que este utilizador vê. */
export function useSettingsMenu() {
  const canSee = useCanSee();
  return NAV_CONTRIBUTIONS.filter((n) => n.section === "settings" && canSee(n));
}

/**
 * Cartões contribuídos pelos módulos para uma ficha (ex.: Email e Chamadas na empresa e no contacto), só com o módulo
 * ativo e a permissão. Cada cartão carrega à parte.
 */
export function RecordPanels({ entity, ...props }: { entity: RecordEntity } & RecordPanelProps) {
  const canSee = useCanSee();
  return (
    <>
      {recordPanelsFor(entity)
        .filter(canSee)
        .filter((p) => !p.when || p.when(props))
        .map(({ id, title, component: Panel }) => (
          <Card key={id}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<p className="text-sm text-muted-foreground">A carregar...</p>}>
                <Panel {...props} />
              </Suspense>
            </CardContent>
          </Card>
        ))}
    </>
  );
}
