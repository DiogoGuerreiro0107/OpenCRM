/**
 * Módulos OPCIONAIS do CRM. O "núcleo" (utilizadores, empresas, contactos, timeline, tarefas, campos
 * personalizados, dashboard, definições) está sempre ativo e não aparece aqui.
 *
 * Este ficheiro é a fonte de verdade de QUE módulos existem; a base de dados (`ModuleSetting`) só guarda SE estão
 * ativos. Módulo sem linha na base = `defaultEnabled`. Ver docs/plano-fase-0-fundacoes.md.
 */
export type ModuleId = "leads" | "deals" | "email" | "zadarma" | "automations" | "assistencias" | "produtos";

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
    description:
      "Regras «quando… então…» sobre negócios, tarefas e leads: mover, criar tarefas, atribuir, webhooks. Inclui a tarefa de primeiro contacto das leads novas: desligar o módulo desliga-a também.",
    dependsOn: [],
    defaultEnabled: true,
  },
  {
    id: "assistencias",
    label: "Assistências",
    description:
      "Pedidos de reparação e suporte técnico: equipamento, problema, diagnóstico e resolução, sobre as tarefas do tipo «Assistência» (passos, agenda e automações).",
    dependsOn: [],
    defaultEnabled: true,
  },
  {
    id: "produtos",
    label: "Produtos",
    description: "Catálogo de produtos: referência, preço, IVA, categorias e fornecedores (com a referência e o preço de custo de cada um).",
    dependsOn: [],
    defaultEnabled: true,
  },
];

export const MODULE_IDS = MODULE_MANIFESTS.map((m) => m.id);

export const isModuleId = (value: string): value is ModuleId => (MODULE_IDS as string[]).includes(value);

export const manifestOf = (id: ModuleId) => MODULE_MANIFESTS.find((m) => m.id === id)!;
