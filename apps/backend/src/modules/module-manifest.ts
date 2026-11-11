/**
 * Módulos OPCIONAIS do CRM. O "núcleo" (utilizadores, empresas, contactos, timeline, tarefas, campos
 * personalizados, dashboard, definições) está sempre ativo e não aparece aqui.
 *
 * Este ficheiro é a fonte de verdade de QUE módulos existem; a base de dados (`ModuleSetting`) só guarda SE estão
 * ativos. Módulo sem linha na base = `defaultEnabled`. Ver docs/plano-fase-0-fundacoes.md.
 */
export type ModuleId = "leads" | "deals" | "email" | "zadarma" | "automations";

export interface ModuleManifest {
  id: ModuleId;
  label: string;
  description: string;
  /** Módulos que têm de estar ativos para este funcionar. */
  dependsOn: ModuleId[];
  /** Estado quando não há nenhuma definição guardada. Tudo ativo, para não mudar o comportamento de quem já usa. */
  defaultEnabled: boolean;
}

export const MODULE_MANIFESTS: ModuleManifest[] = [
  {
    id: "leads",
    label: "Leads",
    description: "Contactos de potenciais clientes e a sua conversão em empresa, contacto e negócio.",
    dependsOn: [],
    defaultEnabled: true,
  },
  {
    id: "deals",
    label: "Funis e negócios",
    description: "Funis de vendas (Kanban), fases e negócios. Sem este módulo a conversão de leads não cria negócios.",
    dependsOn: [],
    defaultEnabled: true,
  },
  {
    id: "email",
    label: "Email",
    description: "Caixa de email integrada (IMAP/SMTP), associação a contactos e modelos de email.",
    dependsOn: [],
    defaultEnabled: true,
  },
  {
    id: "zadarma",
    label: "Telefonia (Zadarma)",
    description: "Chamadas com um clique e histórico de chamadas e gravações.",
    dependsOn: [],
    defaultEnabled: true,
  },
  {
    id: "automations",
    label: "Automações",
    description: "Regras que movem negócios entre fases e disparam webhooks (por agora atuam só sobre negócios).",
    dependsOn: ["deals"],
    defaultEnabled: true,
  },
];

export const MODULE_IDS = MODULE_MANIFESTS.map((m) => m.id);

export const isModuleId = (value: string): value is ModuleId => (MODULE_IDS as string[]).includes(value);

export const manifestOf = (id: ModuleId) => MODULE_MANIFESTS.find((m) => m.id === id)!;
