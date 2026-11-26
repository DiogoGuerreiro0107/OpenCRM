import type { SettingField } from "../extensions/settings";

/**
 * Módulos OPCIONAIS do CRM. O "núcleo" (utilizadores, empresas, contactos, timeline, tarefas, campos
 * personalizados, dashboard, definições) está sempre ativo e não aparece aqui.
 *
 * Este ficheiro é a fonte de verdade de QUE módulos existem; a base de dados (`ModuleSetting`) só guarda SE estão
 * ativos. Módulo sem linha na base = `defaultEnabled`. Ver docs/plano-fase-0-fundacoes.md.
 */
export type ModuleId = "leads" | "deals" | "email" | "zadarma" | "automations" | "assistencias" | "produtos" | "stock" | "encomendas" | "compras";

export interface ModuleManifest {
  id: ModuleId;
  label: string;
  description: string;
  /** Módulos que têm de estar ativos para este funcionar. */
  dependsOn: ModuleId[];
  /** Estado quando não há nenhuma definição guardada. Tudo ativo, para não mudar o comportamento de quem já usa. */
  defaultEnabled: boolean;
  /**
   * O que o módulo declara precisar, como qualquer extensão (Fase E1.1; vocabulário em extensions/permissions.ts).
   * Declaração para o Administrador ler, não uma barreira: o código do módulo corre no backend.
   */
  permissions: string[];
  /** Definições da extensão (Fase E1.3; formato em extensions/settings.ts). */
  settings?: SettingField[];
}

export const MODULE_MANIFESTS: ModuleManifest[] = [
  {
    id: "leads",
    label: "Leads",
    description: "Contactos de potenciais clientes e a sua conversão em empresa, contacto e negócio.",
    dependsOn: [],
    defaultEnabled: true,
    permissions: ["data:leads:write", "data:companies:write", "data:contacts:write", "webhooks:emit"],
    settings: [
      {
        key: "mode",
        label: "Tipo de leads",
        description: "Só muda o que se pode criar; as leads que já existem ficam como estão.",
        type: "select",
        required: true,
        options: [
          { value: "BOTH", label: "Empresas e pessoas" },
          { value: "COMPANY", label: "Só empresas" },
          { value: "PERSON", label: "Só pessoas" },
        ],
        default: "BOTH",
      },
    ],
  },
  {
    id: "deals",
    label: "Funis e negócios",
    description: "Funis de vendas (Kanban), fases e negócios. Sem este módulo a conversão de leads não cria negócios.",
    dependsOn: [],
    defaultEnabled: true,
    permissions: ["data:deals:write", "webhooks:emit"],
  },
  {
    id: "email",
    label: "Email",
    description: "Caixa de email integrada (IMAP/SMTP), associação a contactos e modelos de email.",
    dependsOn: [],
    defaultEnabled: true,
    permissions: ["data:sendEmail:write", "data:emailTemplates:write", "net:egress:configured", "secrets:own"],
  },
  {
    id: "zadarma",
    label: "Telefonia (Zadarma)",
    description: "Chamadas com um clique e histórico de chamadas e gravações.",
    dependsOn: [],
    defaultEnabled: true,
    permissions: ["data:makeCall:write", "net:egress:api.zadarma.com", "secrets:own", "jobs:schedule"],
    settings: [
      { key: "apiKey", label: "API key", description: "Em my.zadarma.com → Definições → API.", type: "text", required: true, maxLength: 200 },
      { key: "apiSecret", label: "API secret", type: "secret", required: true, maxLength: 200 },
      {
        key: "callerExtension",
        label: "Extensão que liga",
        description: "A extensão ou o número que toca primeiro nas chamadas com um clique (ex.: 100).",
        type: "text",
        maxLength: 50,
      },
      { key: "active", label: "Conta ativa", description: "Desligada, não liga nem sincroniza as chamadas.", type: "boolean", default: true },
    ],
  },
  {
    id: "automations",
    label: "Automações",
    description:
      "Regras «quando… então…» sobre negócios, tarefas e leads: mover, criar tarefas, atribuir, webhooks. Inclui a tarefa de primeiro contacto das leads novas: desligar o módulo desliga-a também.",
    dependsOn: [],
    defaultEnabled: true,
    permissions: ["data:deals:write", "data:dailyWork:write", "net:egress:configured", "webhooks:emit", "jobs:schedule"],
  },
  {
    id: "assistencias",
    label: "Assistências",
    description:
      "Pedidos de reparação e suporte técnico: equipamento, problema, diagnóstico e resolução, sobre as tarefas do tipo «Assistência» (passos, agenda e automações).",
    dependsOn: [],
    defaultEnabled: true,
    permissions: ["data:dailyWork:write"],
  },
  {
    id: "produtos",
    label: "Produtos",
    description: "Catálogo de produtos: referência, preço, IVA, categorias e fornecedores (com a referência e o preço de custo de cada um).",
    dependsOn: [],
    defaultEnabled: true,
    permissions: ["data:catalog:write"],
  },
  {
    id: "stock",
    label: "Stock",
    description: "Stock dos produtos como registo de movimentos (entradas, saídas, devoluções, acertos de contagem), com alertas de stock mínimo e negativo.",
    dependsOn: ["produtos"],
    defaultEnabled: true,
    permissions: ["data:stock:write"],
  },
  {
    id: "encomendas",
    label: "Encomendas",
    description: "Encomendas de clientes: linhas de produtos, totais indicativos e estados (rascunho, confirmada, enviada, entregue, cancelada).",
    dependsOn: ["produtos"],
    defaultEnabled: true,
    permissions: ["data:orders:write", "data:companies:write", "data:contacts:write", "webhooks:emit"],
  },
  {
    id: "compras",
    label: "Compras a fornecedor",
    description:
      "Compras aos fornecedores: linhas de produtos com o custo do catálogo, receção (também em parte) que dá entrada no stock e serve as encomendas à espera, e sugestões do que comprar para as encomendas.",
    dependsOn: ["produtos", "stock"],
    defaultEnabled: true,
    permissions: ["data:purchases:write"],
  },
];

export const MODULE_IDS = MODULE_MANIFESTS.map((m) => m.id);

export const isModuleId = (value: string): value is ModuleId => (MODULE_IDS as string[]).includes(value);

export const manifestOf = (id: ModuleId) => MODULE_MANIFESTS.find((m) => m.id === id)!;
