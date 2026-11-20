import { lazy } from "react";
import { FileText, KanbanSquare, Mail, Phone, UserPlus, Zap } from "lucide-react";
import { ADMIN_ONLY } from "@/lib/permissions";
import type { FrontendModule, RecordPanelProps } from "./types";

/**
 * Contribuições dos módulos opcionais atuais (Fase 2c). Cada módulo novo (assistências, encomendas, férias...)
 * acrescenta aqui o seu, ou um ficheiro próprio que o registo junta, sem mexer no menu, nas rotas nem nas fichas.
 */

export const leadsModule: FrontendModule = {
  id: "leads",
  nav: [{ id: "leads:leads", label: "Leads", icon: UserPlus, to: "/leads", section: "main", order: 10 }],
  routes: [{ path: "/leads", page: lazy(() => import("@/pages/leads/LeadsListPage").then((m) => ({ default: m.LeadsListPage }))) }],
  agendaSources: [
    { id: "LEAD_NEXT_ACTION", label: "Próxima ação das leads", open: lazy(() => import("@/pages/agenda/openers").then((m) => ({ default: m.LeadOpener }))) },
  ],
};

export const dealsModule: FrontendModule = {
  id: "deals",
  nav: [{ id: "deals:pipelines", label: "Funis", icon: KanbanSquare, to: "/funis", section: "main", order: 20 }],
  routes: [{ path: "/funis", page: lazy(() => import("@/pages/deals/DealsBoardPage").then((m) => ({ default: m.DealsBoardPage }))) }],
};

export const emailModule: FrontendModule = {
  id: "email",
  nav: [
    { id: "email:inbox", label: "Email", icon: Mail, to: "/email", section: "main", order: 40 },
    { id: "email:templates", label: "Templates de Email", icon: FileText, to: "/configuracoes/templates-email", section: "settings", order: 20, writeArea: "emailTemplates" },
  ],
  routes: [
    { path: "/email", page: lazy(() => import("@/pages/email/EmailInboxPage").then((m) => ({ default: m.EmailInboxPage }))) },
    { path: "/configuracoes/templates-email", writeArea: "emailTemplates", page: lazy(() => import("@/pages/settings/EmailTemplatesSettingsPage").then((m) => ({ default: m.EmailTemplatesSettingsPage }))) },
  ],
  recordPanels: [
    {
      id: "email:messages",
      title: "Email",
      entities: ["company", "contact"],
      order: 10,
      component: lazy(() =>
        import("@/components/email/EmailSection").then((m) => ({
          default: ({ companyId, contactId, email }: RecordPanelProps) => (
            <m.EmailSection companyId={companyId} contactId={contactId} defaultTo={contactId ? (email ?? undefined) : undefined} />
          ),
        })),
      ),
    },
  ],
};

export const zadarmaModule: FrontendModule = {
  id: "zadarma",
  nav: [{ id: "zadarma:settings", label: "Zadarma", icon: Phone, to: "/configuracoes/zadarma", section: "settings", order: 50, roles: ADMIN_ONLY }],
  routes: [{ path: "/configuracoes/zadarma", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/ZadarmaSettingsPage").then((m) => ({ default: m.ZadarmaSettingsPage }))) }],
  recordPanels: [
    {
      id: "zadarma:calls",
      title: "Chamadas",
      entities: ["company", "contact"],
      order: 20,
      component: lazy(() =>
        import("@/components/CallHistorySection").then((m) => ({
          default: ({ companyId, contactId }: RecordPanelProps) => <m.CallHistorySection companyId={companyId} contactId={contactId} />,
        })),
      ),
    },
  ],
};

export const automationsModule: FrontendModule = {
  id: "automations",
  nav: [{ id: "automations:settings", label: "Automações", icon: Zap, to: "/configuracoes/automacoes", section: "settings", order: 30, roles: ADMIN_ONLY }],
  routes: [
    { path: "/configuracoes/automacoes", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/AutomationsSettingsPage").then((m) => ({ default: m.AutomationsSettingsPage }))) },
    { path: "/configuracoes/automacoes/historico", roles: ADMIN_ONLY, page: lazy(() => import("@/pages/settings/AutomationRunsPage").then((m) => ({ default: m.AutomationRunsPage }))) },
  ],
};
