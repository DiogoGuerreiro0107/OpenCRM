import { coreModule } from "./core";
import { automationsModule, dealsModule, emailModule, leadsModule, ordersModule, productsModule, servicesModule, zadarmaModule } from "./optional-modules";
import type { AgendaSourceContribution, FrontendModule, NavContribution, RecordEntity, RecordPanelContribution, RouteContribution } from "./types";

/** Todos os módulos do frontend. Um módulo novo junta-se aqui. */
export const FRONTEND_MODULES: FrontendModule[] = [coreModule, leadsModule, dealsModule, emailModule, servicesModule, productsModule, ordersModule, zadarmaModule, automationsModule];

/** As contribuições herdam o módulo que as declara (o núcleo não tem), salvo se indicarem outro. */
function withModule<T extends { module?: FrontendModule["id"] }>(mod: FrontendModule, items: T[] | undefined) {
  return (items ?? []).map((item) => ({ ...item, module: item.module ?? (mod.id === "core" ? undefined : mod.id) }));
}

export const NAV_CONTRIBUTIONS: NavContribution[] = FRONTEND_MODULES.flatMap((m) => withModule(m, m.nav)).sort((a, b) => a.order - b.order);

export const ROUTE_CONTRIBUTIONS: RouteContribution[] = FRONTEND_MODULES.flatMap((m) => withModule(m, m.routes));

export const RECORD_PANELS: RecordPanelContribution[] = FRONTEND_MODULES.flatMap((m) => withModule(m, m.recordPanels)).sort((a, b) => a.order - b.order);

export const recordPanelsFor = (entity: RecordEntity) => RECORD_PANELS.filter((p) => p.entities.includes(entity));

export const AGENDA_SOURCES: AgendaSourceContribution[] = FRONTEND_MODULES.flatMap((m) => withModule(m, m.agendaSources));
