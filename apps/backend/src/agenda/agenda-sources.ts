import { Prisma } from "@prisma/client";
import { ModuleId } from "../modules/module-manifest";
import { PrismaService } from "../prisma/prisma.service";
import { isOpenStatus } from "../tasks/work-item-status";

/**
 * Fontes da agenda (Fase 2d, docs/plano-fase-2-itens-de-trabalho.md). Cada fonte devolve, num intervalo, as primeiras
 * `perDay` entradas de cada dia (no fuso pedido) e quantas há em cada dia: a resposta tem tamanho limitado, seja qual
 * for o volume. Um módulo novo (férias, mapas...) junta aqui uma linha. Um teste estrutural confere cada linha.
 */

export interface AgendaEntry {
  source: AgendaSourceId;
  id: string;
  title: string;
  /** Dia (AAAA-MM-DD) no fuso pedido. */
  day: string;
  /** Instante (ISO). Nas entradas de dia inteiro, o início do dia. */
  start: string;
  /** Fim do horário marcado (ISO), quando há. */
  end: string | null;
  /** «scheduled» = horário marcado; «due» = prazo; «date» = só a data (dia inteiro). */
  kind: "scheduled" | "due" | "date";
  /** Concluída ou cancelada. */
  closed: boolean;
  cancelled: boolean;
  type: { id: string; name: string; icon: string; color: string } | null;
  assignee: { id: string; name: string } | null;
}

export interface AgendaQuery {
  from: Date;
  to: Date;
  /** Dias (AAAA-MM-DD) do início e do fim do intervalo no fuso pedido (para as fontes que só têm datas). */
  fromDay: string;
  toDay: string;
  tz: string;
  perDay: number;
  assigneeId?: string;
  typeId?: string;
}

export interface AgendaSource {
  label: string;
  /** Módulo opcional de que depende (desligado: a fonte não entra); `null` = núcleo. */
  module: ModuleId | null;
  /** Fonte só de tarefas: o filtro por tipo aplica-se; nas outras, um filtro por tipo tira a fonte. */
  filtersByType: boolean;
  fetch: (prisma: PrismaService, q: AgendaQuery) => Promise<{ entries: AgendaEntry[]; countsByDay: Record<string, number> }>;
}

type Ranked = { id: string; day: string; n: bigint };

const countsOf = (rows: Ranked[]) => Object.fromEntries(rows.map((r) => [r.day, Number(r.n)]));

/** Leads ainda em aberto (as convertidas e perdidas não têm próxima ação a fazer). */
export const OPEN_LEAD_STATUSES = ["NOVO", "CONTACTADO", "SEM_RESPOSTA"] as const;

export const AGENDA_SOURCES = {
  /** Tarefas: pelo momento na agenda (início marcado, senão o prazo). */
  WORK_ITEM: {
    label: "Tarefas",
    module: null,
    filtersByType: true,
    fetch: async (prisma, q) => {
      const assignee = q.assigneeId ? Prisma.sql`AND t."assigneeId" = ${q.assigneeId}` : Prisma.empty;
      const type = q.typeId ? Prisma.sql`AND t."typeId" = ${q.typeId}` : Prisma.empty;
      const rows = await prisma.$queryRaw<Ranked[]>`
        SELECT id, day, n FROM (
          SELECT t.id, d.day,
            row_number() OVER (PARTITION BY d.day ORDER BY t."agendaAt", t.id) AS rn,
            count(*) OVER (PARTITION BY d.day) AS n
          FROM "WorkItem" t
          CROSS JOIN LATERAL (SELECT to_char((t."agendaAt" AT TIME ZONE 'UTC') AT TIME ZONE ${q.tz}, 'YYYY-MM-DD') AS day) d
          WHERE t."agendaAt" >= ${q.from} AND t."agendaAt" <= ${q.to} ${assignee} ${type}
        ) x
        WHERE rn <= ${q.perDay}`;
      const dayOf = new Map(rows.map((r) => [r.id, r.day]));
      const items = await prisma.workItem.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
        select: {
          id: true, title: true, status: true, dueDate: true, scheduledStart: true, scheduledEnd: true,
          type: { select: { id: true, name: true, icon: true, color: true } },
          assignee: { select: { id: true, name: true } },
        },
      });
      const entries = items.map((t): AgendaEntry => ({
        source: "WORK_ITEM",
        id: t.id,
        title: t.title,
        day: dayOf.get(t.id)!,
        start: (t.scheduledStart ?? t.dueDate)!.toISOString(),
        end: t.scheduledStart ? (t.scheduledEnd?.toISOString() ?? null) : null,
        kind: t.scheduledStart ? "scheduled" : "due",
        closed: !isOpenStatus(t.status),
        cancelled: t.status === "CANCELLED",
        type: t.type,
        assignee: t.assignee,
      }));
      return { entries, countsByDay: countsOf(rows) };
    },
  },
  /** Próxima ação das leads em aberto: só uma data (dia inteiro), guardada como meia-noite UTC. */
  LEAD_NEXT_ACTION: {
    label: "Próxima ação das leads",
    module: "leads",
    filtersByType: false,
    fetch: async (prisma, q) => {
      const assignee = q.assigneeId ? Prisma.sql`AND l."responsavelId" = ${q.assigneeId}` : Prisma.empty;
      const rows = await prisma.$queryRaw<Ranked[]>`
        SELECT id, day, n FROM (
          SELECT l.id, d.day,
            row_number() OVER (PARTITION BY d.day ORDER BY l."nextActionAt", l.id) AS rn,
            count(*) OVER (PARTITION BY d.day) AS n
          FROM "Lead" l
          CROSS JOIN LATERAL (SELECT to_char(l."nextActionAt", 'YYYY-MM-DD') AS day) d
          WHERE l."nextActionAt" >= ${q.fromDay}::date AND l."nextActionAt" < (${q.toDay}::date + 1)
            AND l.status::text IN (${Prisma.join([...OPEN_LEAD_STATUSES])}) ${assignee}
        ) x
        WHERE rn <= ${q.perDay}`;
      const dayOf = new Map(rows.map((r) => [r.id, r.day]));
      const leads = await prisma.lead.findMany({
        where: { id: { in: rows.map((r) => r.id) } },
        select: { id: true, name: true, companyName: true, nextActionAt: true, responsavel: { select: { id: true, name: true } } },
      });
      const entries = leads.map((l): AgendaEntry => ({
        source: "LEAD_NEXT_ACTION",
        id: l.id,
        title: l.companyName && l.companyName !== l.name ? `${l.name} (${l.companyName})` : l.name,
        day: dayOf.get(l.id)!,
        start: l.nextActionAt!.toISOString(),
        end: null,
        kind: "date",
        closed: false,
        cancelled: false,
        type: null,
        assignee: l.responsavel,
      }));
      return { entries, countsByDay: countsOf(rows) };
    },
  },
} satisfies Record<string, AgendaSource>;

export type AgendaSourceId = keyof typeof AGENDA_SOURCES;

export const AGENDA_SOURCE_IDS = Object.keys(AGENDA_SOURCES) as AgendaSourceId[];

export const isAgendaSourceId = (value: unknown): value is AgendaSourceId =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(AGENDA_SOURCES, value);
