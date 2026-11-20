import { PrismaClient } from "@prisma/client";
import { foldSearch } from "../common/search-text";

/**
 * Tipos de item de trabalho (Fase 2a, docs/plano-fase-2-itens-de-trabalho.md). O id é o código estável do tipo.
 *
 * Os tipos de SISTEMA existem sempre: a migração 20261119130000_itens_de_trabalho cria-os (com os mesmos valores) e o
 * arranque repõe os que faltem (`ensureSystemWorkItemTypes`), sem nunca alterar os existentes — o Administrador pode
 * tê-los renomeado. Podem ser renomeados e desativados, mas não apagados. Os módulos (assistências, encomendas...)
 * juntam aqui os seus.
 */
export const DEFAULT_WORK_ITEM_TYPE = "TAREFA";

/** Ícones que a interface sabe desenhar (nomes do lucide-react). Lista fechada: nada de SVG vindo da base de dados. */
export const WORK_ITEM_ICONS = [
  "check-square", "phone", "mail", "map-pin", "file-text", "banknote", "wrench", "circle-dot", "calendar", "clock",
  "truck", "package", "clipboard-list", "users", "user", "star", "flag", "shopping-cart", "printer", "monitor",
  "laptop", "building-2", "handshake", "headphones", "hammer", "receipt", "bell", "briefcase", "message-square",
  "camera",
] as const;

/** Paleta fechada (nomes de cores do Tailwind; o frontend tem as classes de cada uma). */
export const WORK_ITEM_COLORS = [
  "slate", "gray", "red", "orange", "amber", "yellow", "green", "teal", "blue", "indigo", "violet", "pink",
] as const;

export interface SystemWorkItemType {
  id: string;
  name: string;
  icon: (typeof WORK_ITEM_ICONS)[number];
  color: (typeof WORK_ITEM_COLORS)[number];
}

/** Tipo das assistências (Fase 4a): cada item deste tipo tem os dados próprios em `ServiceCase`. */
export const SERVICE_CASE_TYPE = "ASSISTENCIA";

export const SYSTEM_WORK_ITEM_TYPES: SystemWorkItemType[] = [
  { id: "TAREFA", name: "Tarefa", icon: "check-square", color: "slate" },
  { id: "CHAMADA", name: "Chamada", icon: "phone", color: "blue" },
  { id: "EMAIL", name: "Email", icon: "mail", color: "violet" },
  { id: "VISITA", name: "Visita", icon: "map-pin", color: "green" },
  { id: "PROPOSTA", name: "Proposta", icon: "file-text", color: "amber" },
  { id: "COBRANCA", name: "Cobrança", icon: "banknote", color: "red" },
  { id: "ASSISTENCIA", name: "Assistência", icon: "wrench", color: "teal" },
  { id: "OUTRO", name: "Outro", icon: "circle-dot", color: "gray" },
];

/** Cria os tipos de sistema que faltem (nunca altera os que existem). Corre no arranque e depois de limpar a base de testes. */
export async function ensureSystemWorkItemTypes(prisma: Pick<PrismaClient, "workItemType">) {
  await prisma.workItemType.createMany({
    data: SYSTEM_WORK_ITEM_TYPES.map((t, i) => ({ ...t, isSystem: true, sortOrder: i })),
    skipDuplicates: true,
  });
}

/** Código de um tipo novo a partir do nome («Instalação de rede» → INSTALACAO_DE_REDE), sem repetir um que exista. */
export function workItemTypeIdFor(name: string, taken: Set<string>) {
  const base =
    foldSearch(name)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "TIPO";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  }
}
