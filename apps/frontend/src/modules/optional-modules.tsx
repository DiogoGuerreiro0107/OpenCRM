import { lazy } from "react";
import { FileText, KanbanSquare, Mail, Package, PackageCheck, Phone, ShoppingCart, Tags, Truck, UserPlus, Wrench, Zap } from "lucide-react";
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
  // As credenciais são definições da extensão (Fase E1.3), na página genérica.
  nav: [{ id: "zadarma:settings", label: "Zadarma", icon: Phone, to: "/configuracoes/extensoes/zadarma", section: "settings", order: 50, roles: ADMIN_ONLY }],
  routes: [],
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

export const servicesModule: FrontendModule = {
  id: "assistencias",
  nav: [{ id: "assistencias:list", label: "Assistências", icon: Wrench, to: "/assistencias", section: "main", order: 35 }],
  routes: [
    { path: "/assistencias", page: lazy(() => import("@/pages/service-cases/ServiceCasesListPage").then((m) => ({ default: m.ServiceCasesListPage }))) },
    { path: "/assistencias/indicadores", page: lazy(() => import("@/pages/service-cases/ServiceIndicatorsPage").then((m) => ({ default: m.ServiceIndicatorsPage }))) },
    { path: "/assistencias/:id", page: lazy(() => import("@/pages/service-cases/ServiceCaseDetailPage").then((m) => ({ default: m.ServiceCaseDetailPage }))) },
  ],
  recordPanels: [
    {
      id: "assistencias:cases",
      title: "Assistências",
      entities: ["company", "contact"],
      order: 15,
      component: lazy(() => import("@/pages/service-cases/ServiceCasesPanel").then((m) => ({ default: m.ServiceCasesPanel }))),
    },
  ],
};

export const productsModule: FrontendModule = {
  id: "produtos",
  nav: [
    { id: "produtos:list", label: "Produtos", icon: Package, to: "/produtos", section: "main", order: 38 },
    { id: "produtos:categories", label: "Categorias de produtos", icon: Tags, to: "/configuracoes/categorias-produtos", section: "settings", order: 25, writeArea: "catalog" },
  ],
  routes: [
    { path: "/produtos", page: lazy(() => import("@/pages/products/ProductsListPage").then((m) => ({ default: m.ProductsListPage }))) },
    { path: "/produtos/:id", page: lazy(() => import("@/pages/products/ProductDetailPage").then((m) => ({ default: m.ProductDetailPage }))) },
    { path: "/configuracoes/categorias-produtos", writeArea: "catalog", page: lazy(() => import("@/pages/products/ProductCategoriesSettingsPage").then((m) => ({ default: m.ProductCategoriesSettingsPage }))) },
  ],
  recordPanels: [
    {
      id: "produtos:supplied",
      title: "Produtos fornecidos",
      entities: ["company"],
      order: 30,
      when: (props) => !!props.isSupplier,
      component: lazy(() => import("@/pages/products/SupplierProductsPanel").then((m) => ({ default: m.SupplierProductsPanel }))),
    },
  ],
};

/** Encomendas de cliente (Fase 6a): menu, lista, ficha e o cartão nas fichas de empresa e contacto. */
export const ordersModule: FrontendModule = {
  id: "encomendas",
  nav: [
    { id: "encomendas:list", label: "Encomendas", icon: ShoppingCart, to: "/encomendas", section: "main", order: 39 },
    // Transportadoras (Fase 6d), para as expedições.
    { id: "encomendas:carriers", label: "Transportadoras", icon: PackageCheck, to: "/configuracoes/transportadoras", section: "settings", order: 26, writeArea: "orders" },
  ],
  routes: [
    { path: "/encomendas", page: lazy(() => import("@/pages/orders/OrdersListPage").then((m) => ({ default: m.OrdersListPage }))) },
    { path: "/encomendas/:id", page: lazy(() => import("@/pages/orders/OrderDetailPage").then((m) => ({ default: m.OrderDetailPage }))) },
    { path: "/configuracoes/transportadoras", writeArea: "orders", page: lazy(() => import("@/pages/orders/CarriersSettingsPage").then((m) => ({ default: m.CarriersSettingsPage }))) },
  ],
  recordPanels: [
    {
      id: "encomendas:orders",
      title: "Encomendas",
      entities: ["company", "contact"],
      order: 25,
      component: lazy(() => import("@/pages/orders/OrdersPanel").then((m) => ({ default: m.OrdersPanel }))),
    },
  ],
};

/** Compras a fornecedor (Fase 6c): menu, lista, sugestões, ficha e o cartão nas fichas das empresas fornecedoras. */
export const purchasesModule: FrontendModule = {
  id: "compras",
  nav: [{ id: "compras:list", label: "Compras", icon: Truck, to: "/compras", section: "main", order: 39.5 }],
  routes: [
    { path: "/compras", page: lazy(() => import("@/pages/purchases/PurchasesListPage").then((m) => ({ default: m.PurchasesListPage }))) },
    { path: "/compras/sugestoes", page: lazy(() => import("@/pages/purchases/PurchaseSuggestionsPage").then((m) => ({ default: m.PurchaseSuggestionsPage }))) },
    { path: "/compras/:id", page: lazy(() => import("@/pages/purchases/PurchaseDetailPage").then((m) => ({ default: m.PurchaseDetailPage }))) },
  ],
  recordPanels: [
    {
      id: "compras:purchases",
      title: "Compras",
      entities: ["company"],
      order: 31,
      when: (props) => !!props.isSupplier,
      component: lazy(() => import("@/pages/purchases/PurchasesPanel").then((m) => ({ default: m.PurchasesPanel }))),
    },
  ],
};

