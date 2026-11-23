import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { AgendaSourceId, Role } from "@opencrm/shared-types";
import type { ModuleId } from "@/lib/modules-api";
import type { WriteArea } from "@/lib/permissions";

/**
 * Registo de contribuições da interface (Fase 2c, docs/plano-fase-2-itens-de-trabalho.md). Cada módulo do frontend
 * declara aqui o que acrescenta ao núcleo: itens de menu, rotas e cartões nas fichas. O núcleo mostra cada contribuição
 * só com o módulo ativo e a permissão; o backend continua a impor as duas coisas em cada rota.
 */

/** Quem vê uma contribuição. Sem `roles` nem `writeArea`, todos os utilizadores com sessão. */
export interface Visibility {
  /** Módulo opcional de que depende (por omissão, o módulo que a declara; o núcleo não tem). */
  module?: ModuleId;
  /** Papéis fixos (administração). */
  roles?: Role[];
  /** Área de escrita configurável (Configurações > Permissões). */
  writeArea?: WriteArea;
}

export interface NavContribution extends Visibility {
  /** Id estável (as preferências do menu guardam-no): `<módulo>:<nome>`. */
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  /** «main» = menu principal (configurável); «settings» = configurações (fixo). */
  section: "main" | "settings";
  /** Posição no menu por omissão (menor primeiro). */
  order: number;
}

export interface RouteContribution extends Visibility {
  path: string;
  /** Página carregada à parte (React.lazy): só se descarrega quando se abre. */
  page: ComponentType;
}

/** Fichas onde um cartão pode aparecer. */
export type RecordEntity = "company" | "contact" | "deal" | "lead";

/** O que a ficha passa a cada cartão. */
export interface RecordPanelProps {
  companyId?: string;
  contactId?: string;
  dealId?: string;
  leadId?: string;
  /** Email do registo (para pré-preencher o destinatário). */
  email?: string | null;
  /** A empresa é fornecedor (Fase 5a). */
  isSupplier?: boolean;
}

export interface RecordPanelContribution extends Visibility {
  id: string;
  title: string;
  entities: RecordEntity[];
  /** Posição entre os cartões contribuídos (menor primeiro). */
  order: number;
  /** Componente carregado à parte (React.lazy). */
  component: ComponentType<RecordPanelProps>;
  /** Só aparece quando isto é verdade (ex.: «Produtos fornecidos» só nos fornecedores). */
  when?: (props: RecordPanelProps) => boolean;
}

/** Fonte da agenda (Fase 2d): o servidor dá as entradas; aqui fica o nome do filtro e como se abre uma entrada. */
export interface AgendaSourceContribution extends Visibility {
  id: AgendaSourceId;
  label: string;
  /** Diálogo (carregado à parte) que abre a entrada com este id. */
  open: ComponentType<{ id: string; onClose: () => void }>;
}

export interface FrontendModule {
  /** Módulo opcional, ou «core» (sempre ativo). As contribuições herdam-no como `module`. */
  id: ModuleId | "core";
  nav?: NavContribution[];
  routes?: RouteContribution[];
  recordPanels?: RecordPanelContribution[];
  agendaSources?: AgendaSourceContribution[];
}
