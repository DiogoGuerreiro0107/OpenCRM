import { Role } from "@prisma/client";

/**
 * Permissões de ESCRITA (POST/PATCH/PUT/DELETE) por papel. A leitura é aberta a qualquer utilizador autenticado
 * (CRM interno), exceto onde um controller usar @Roles() explicitamente.
 *
 * Desde a Fase 0d (docs/plano-fase-0-fundacoes.md):
 *  - a ADMINISTRAÇÃO é fixa: `ADMIN_ONLY` (nunca configurável, para ninguém se dar acesso à gestão de utilizadores);
 *  - as restantes áreas são CONFIGURÁVEIS pelo Administrador; o que está aqui é a PREDEFINIÇÃO (sem configuração
 *    na base de dados, vale isto — igual ao que existia antes). Usar `@WriteArea("...")` nas rotas e o
 *    `PermissionsService` nos serviços, nunca as listas daqui diretamente.
 *  - invariantes: o Administrador está sempre em todas as áreas; `LEITURA_APENAS` nunca escreve.
 */
const ADMIN: Role = "ADMINISTRADOR";
const COMERCIAL: Role = "COMERCIAL";
const TECNICO: Role = "TECNICO";
const BACKOFFICE: Role = "BACKOFFICE";
const FINANCEIRO: Role = "FINANCEIRO";

/** Configuração sensível (utilizadores, módulos, permissões, chaves, webhooks, auditoria...): só o Administrador. */
export const ADMIN_ONLY: Role[] = [ADMIN];

export interface WriteAreaDefinition {
  label: string;
  description: string;
  defaultRoles: Role[];
}

export const WRITE_AREAS = {
  companies: {
    label: "Empresas",
    description: "Criar, alterar e eliminar empresas e preencher os seus campos personalizados.",
    defaultRoles: [ADMIN, COMERCIAL, BACKOFFICE, FINANCEIRO],
  },
  contacts: {
    label: "Contactos",
    description: "Criar, alterar e eliminar contactos e preencher os seus campos personalizados.",
    defaultRoles: [ADMIN, COMERCIAL, BACKOFFICE],
  },
  leads: {
    label: "Leads",
    description: "Criar, alterar, converter e eliminar leads e preencher os seus campos personalizados.",
    defaultRoles: [ADMIN, COMERCIAL, BACKOFFICE],
  },
  deals: {
    label: "Negócios",
    description: "Criar, mover e eliminar negócios e preencher os seus campos personalizados.",
    defaultRoles: [ADMIN, COMERCIAL, BACKOFFICE],
  },
  dailyWork: {
    label: "Trabalho do dia-a-dia",
    description: "Tarefas e notas na timeline.",
    defaultRoles: [ADMIN, COMERCIAL, TECNICO, BACKOFFICE, FINANCEIRO],
  },
  sendEmail: {
    label: "Enviar email",
    description: "Enviar emails a partir do CRM.",
    defaultRoles: [ADMIN, COMERCIAL, BACKOFFICE],
  },
  makeCall: {
    label: "Ligar (telefonia)",
    description: "Iniciar chamadas pela Zadarma.",
    defaultRoles: [ADMIN, COMERCIAL, TECNICO, BACKOFFICE],
  },
  emailTemplates: {
    label: "Modelos de email",
    description: "Criar, alterar e eliminar modelos de email.",
    defaultRoles: [ADMIN, BACKOFFICE],
  },
  catalog: {
    label: "Catálogo de produtos",
    description: "Criar e alterar produtos, preços, categorias e fornecedores dos produtos. Só quem tem esta área vê os preços de custo e as margens.",
    defaultRoles: [ADMIN, BACKOFFICE, FINANCEIRO],
  },
  stock: {
    label: "Movimentos de stock",
    description: "Lançar entradas, saídas, devoluções, stock inicial e acertos de contagem. Ver o stock é para todos.",
    defaultRoles: [ADMIN, BACKOFFICE],
  },
  orders: {
    label: "Encomendas",
    description: "Criar e alterar encomendas de clientes e as suas linhas, confirmar, marcar como enviadas ou entregues e cancelar. Ver as encomendas é para todos.",
    defaultRoles: [ADMIN, COMERCIAL, BACKOFFICE],
  },
  purchases: {
    label: "Compras a fornecedor",
    description: "Criar e alterar compras a fornecedores e as suas linhas, marcar como enviadas, registar receções (dão entrada no stock), fechar e cancelar. Ver as compras é para todos; os custos só com a área «Catálogo de produtos».",
    defaultRoles: [ADMIN, BACKOFFICE],
  },
} satisfies Record<string, WriteAreaDefinition>;

export type WriteArea = keyof typeof WRITE_AREAS;

export const WRITE_AREA_KEYS = Object.keys(WRITE_AREAS) as WriteArea[];

export const isWriteArea = (value: unknown): value is WriteArea =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(WRITE_AREAS, value);
