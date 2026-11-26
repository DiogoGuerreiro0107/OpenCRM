import { lazy } from "react";
import { Building2, CalendarDays, CheckSquare, Clock, KeyRound, LayoutDashboard, ListChecks, PanelLeft, Puzzle, ScrollText, Settings, ShieldCheck, UserCog, Users, Webhook } from "lucide-react";
import { ADMIN_ONLY } from "@/lib/permissions";
import type { FrontendModule } from "./types";

/** Núcleo (sempre ativo): dashboard, tarefas, empresas, contactos e a administração. */
export const coreModule: FrontendModule = {
  id: "core",
  nav: [
    { id: "core:dashboard", label: "Dashboard", icon: LayoutDashboard, to: "/dashboard", section: "main", order: 0 },
    { id: "core:agenda", label: "Agenda", icon: CalendarDays, to: "/agenda", section: "main", order: 25 },
    { id: "core:tasks", label: "Tarefas", icon: CheckSquare, to: "/tarefas", section: "main", order: 30 },
    { id: "core:companies", label: "Empresas", icon: Building2, to: "/empresas", section: "main", order: 50 },
    { id: "core:contacts", label: "Contactos", icon: Users, to: "/contactos", section: "main", order: 60 },
    { id: "core:custom-fields", label: "Campos Personalizados", icon: Settings, to: "/configuracoes/campos-personalizados", section: "settings", order: 0, roles: ADMIN_ONLY },
    { id: "core:work-item-types", label: "Tipos de tarefa", icon: ListChecks, to: "/configuracoes/tipos-de-tarefa", section: "settings", order: 10, roles: ADMIN_ONLY },
    { id: "core:menu", label: "Menu", icon: PanelLeft, to: "/configuracoes/menu", section: "settings", order: 15, roles: ADMIN_ONLY },
    { id: "core:users", label: "Utilizadores", icon: UserCog, to: "/configuracoes/utilizadores", section: "settings", order: 40, roles: ADMIN_ONLY },
    { id: "core:jobs", label: "Tarefas agendadas", icon: Clock, to: "/configuracoes/tarefas-agendadas", section: "settings", order: 65, roles: ADMIN_ONLY },
    { id: "core:modules", label: "Módulos e extensões", icon: Puzzle, to: "/configuracoes/modulos", section: "settings", order: 60, roles: ADMIN_ONLY },
    { id: "core:permissions", label: "Permissões", icon: ShieldCheck, to: "/configuracoes/permissoes", section: "settings", order: 70, roles: ADMIN_ONLY },
    { id: "core:api-keys", label: "Chaves de API", icon: KeyRound, to: "/configuracoes/chaves-api", section: "settings", order: 80, roles: ADMIN_ONLY },
    { id: "core:webhooks", label: "Webhooks", icon: Webhook, to: "/configuracoes/webhooks", section: "settings", order: 90, roles: ADMIN_ONLY },
    { id: "core:audit", label: "Auditoria", icon: ScrollText, to: "/configuracoes/auditoria", section: "settings", order: 100, roles: ADMIN_ONLY },
  ],
  routes: [
    { path: "/dashboard", page: lazy(() => import("@/pages/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage }))) },
    { path: "/empresas", page: lazy(() => import("@/pages/companies/CompaniesListPage").then((m) => ({ default: m.CompaniesListPage }))) },
    { path: "/empresas/novo", page: lazy(() => import("@/pages/companies/NewCompanyPage").then((m) => ({ default: m.NewCompanyPage }))) },
    { path: "/empresas/:id", page: lazy(() => import("@/pages/companies/CompanyDetailPage").then((m) => ({ default: m.CompanyDetailPage }))) },
    { path: "/contactos", page: lazy(() => import("@/pages/contacts/ContactsListPage").then((m) => ({ default: m.ContactsListPage }))) },
    { path: "/contactos/novo", page: lazy(() => import("@/pages/contacts/NewContactPage").then((m) => ({ default: m.NewContactPage }))) },
    { path: "/contactos/:id", page: lazy(() => import("@/pages/contacts/ContactDetailPage").then((m) => ({ default: m.ContactDetailPage }))) },
    { path: "/agenda", page: lazy(() => import("@/pages/agenda/AgendaPage").then((m) => ({ default: m.AgendaPage }))) },
    { path: "/tarefas", page: lazy(() => import("@/pages/tasks/TasksListPage").then((m) => ({ default: m.TasksListPage }))) },
    { path: "/tarefas/tipo/:typeId", page: lazy(() => import("@/pages/tasks/WorkItemTypePage").then((m) => ({ default: m.WorkItemTypePage }))) },
    { path: "/configuracoes/campos-personalizados", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/CustomFieldsSettingsPage").then((m) => ({ default: m.CustomFieldsSettingsPage }))) },
    { path: "/configuracoes/tipos-de-tarefa", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/WorkItemTypesSettingsPage").then((m) => ({ default: m.WorkItemTypesSettingsPage }))) },
    { path: "/configuracoes/menu", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/MenuSettingsPage").then((m) => ({ default: m.MenuSettingsPage }))) },
    { path: "/configuracoes/utilizadores", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/UsersSettingsPage").then((m) => ({ default: m.UsersSettingsPage }))) },
    { path: "/configuracoes/modulos", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/ModulesSettingsPage").then((m) => ({ default: m.ModulesSettingsPage }))) },
    { path: "/configuracoes/tarefas-agendadas", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/JobsSettingsPage").then((m) => ({ default: m.JobsSettingsPage }))) },
    { path: "/configuracoes/permissoes", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/PermissionsSettingsPage").then((m) => ({ default: m.PermissionsSettingsPage }))) },
    { path: "/configuracoes/chaves-api", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/ApiKeysPage").then((m) => ({ default: m.ApiKeysPage }))) },
    { path: "/configuracoes/webhooks", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/WebhooksPage").then((m) => ({ default: m.WebhooksPage }))) },
    { path: "/configuracoes/auditoria", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/AuditPage").then((m) => ({ default: m.AuditPage }))) },
  ],
  agendaSources: [{ id: "WORK_ITEM", label: "Tarefas", open: lazy(() => import("@/pages/agenda/openers").then((m) => ({ default: m.TaskOpener }))) }],
};
