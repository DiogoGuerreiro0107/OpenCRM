import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgendaEntry, AgendaSourceId } from "@opencrm/shared-types";
import { getAgenda } from "@/lib/agenda-api";
import { listWorkItemTypes } from "@/lib/work-item-types-api";
import { useCanWrite } from "@/lib/useCanWrite";
import { cn } from "@/lib/utils";
import { AGENDA_SOURCES } from "@/modules/registry";
import { useCanSee } from "@/modules/hooks";
import { buildMonthGrid, monthGridRange, toDayKey } from "@/components/calendar/MonthCalendar";
import { workItemColor } from "@/components/WorkItemTypeBadge";
import { UserPicker } from "@/components/pickers";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { TaskDialog } from "@/pages/tasks/TaskDialog";

type View = "month" | "week" | "day";

/** Entradas por dia que cada vista pede (o resto aparece como «+N»). */
const PER_DAY: Record<View, number> = { month: 3, week: 20, day: 50 };
const VIEW_LABELS: Record<View, string> = { month: "Mês", week: "Semana", day: "Dia" };
const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function startOfWeek(date: Date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function endOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Dias que a vista mostra e o intervalo a pedir ao servidor. */
function rangeOf(view: View, anchor: Date) {
  if (view === "month") return { days: buildMonthGrid(anchor), ...monthGridRange(anchor) };
  const first = view === "week" ? startOfWeek(anchor) : new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => addDays(first, i));
  return { days, from: days[0].toISOString(), to: endOfDay(days[days.length - 1]).toISOString() };
}

function move(view: View, anchor: Date, delta: number) {
  if (view === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
  return addDays(anchor, view === "week" ? 7 * delta : delta);
}

function title(view: View, days: Date[], anchor: Date) {
  if (view === "month") return anchor.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  if (view === "day") return anchor.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fmt = (d: Date) => d.toLocaleDateString("pt-PT", { day: "numeric", month: "short" });
  return `${fmt(days[0])} – ${fmt(days[6])} ${days[6].getFullYear()}`;
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

/** Hora a mostrar: horário marcado (início–fim), prazo, ou dia inteiro. */
function timeLabel(entry: AgendaEntry) {
  if (entry.kind === "date") return "Dia inteiro";
  if (entry.kind === "due") return `Prazo ${hhmm(entry.start)}`;
  return entry.end ? `${hhmm(entry.start)}–${hhmm(entry.end)}` : hhmm(entry.start);
}

/**
 * Agenda (Fase 2d, docs/plano-fase-2-itens-de-trabalho.md): mês, semana e dia, com as fontes registadas (tarefas,
 * próxima ação das leads...). Filtros por responsável (ver a agenda de um colega), tipo de tarefa e fonte.
 */
export function AgendaPage() {
  const canCreate = useCanWrite("dailyWork");
  const canSee = useCanSee();
  const sources = AGENDA_SOURCES.filter(canSee);
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [assigneeId, setAssigneeId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [hidden, setHidden] = useState<AgendaSourceId[]>([]);
  const [opening, setOpening] = useState<{ source: AgendaSourceId; id: string } | null>(null);
  const [creatingOn, setCreatingOn] = useState<string | null>(null);

  const { data: types = [] } = useQuery({ queryKey: ["work-item-types", "all"], queryFn: () => listWorkItemTypes() });
  const range = rangeOf(view, anchor);
  const wanted = sources.map((s) => s.id).filter((id) => !hidden.includes(id));
  const agenda = useQuery({
    queryKey: ["agenda", view, range.from, range.to, assigneeId, typeId, wanted.join(",")],
    queryFn: () => getAgenda({ from: range.from, to: range.to, perDay: PER_DAY[view], sources: wanted, assigneeId: assigneeId || undefined, typeId: typeId || undefined }),
    enabled: wanted.length > 0,
  });
  const entriesByDay = new Map<string, AgendaEntry[]>();
  for (const entry of wanted.length > 0 ? (agenda.data?.entries ?? []) : []) entriesByDay.set(entry.day, [...(entriesByDay.get(entry.day) ?? []), entry]);
  const countOf = (day: string) => (wanted.length > 0 ? (agenda.data?.countsByDay[day] ?? 0) : 0);
  const todayKey = toDayKey(new Date());
  const Opener = opening ? sources.find((s) => s.id === opening.source)?.open : undefined;

  const openDay = (day: Date) => {
    setView("day");
    setAnchor(day);
  };

  const entryButton = (entry: AgendaEntry, compact: boolean) => (
    <button
      key={`${entry.source}:${entry.id}`}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setOpening({ source: entry.source, id: entry.id });
      }}
      title={`${timeLabel(entry)} · ${entry.title}${entry.assignee ? ` · ${entry.assignee.name}` : ""}`}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left",
        compact ? "text-[11px]" : "text-sm",
        entry.cancelled ? "bg-gray-100 text-gray-500 line-through" : entry.closed ? "bg-green-100 text-green-800 line-through" : entry.source === "LEAD_NEXT_ACTION" ? "bg-amber-50 text-amber-900" : "bg-primary/10 text-primary",
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", entry.type ? workItemColor(entry.type.color).dot : "bg-amber-500")} aria-hidden />
      {!compact && <span className="w-28 shrink-0 text-xs text-muted-foreground">{timeLabel(entry)}</span>}
      <span className="truncate">{entry.title}</span>
      {!compact && entry.assignee && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{entry.assignee.name}</span>}
    </button>
  );

  const more = (day: Date, key: string, shown: number) =>
    countOf(key) > shown && (
      <button type="button" className="text-[11px] text-muted-foreground hover:underline" onClick={(e) => { e.stopPropagation(); openDay(day); }}>
        +{countOf(key) - shown}
      </button>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Vista">
          {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("px-3 py-1.5 text-sm", view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <UserPicker aria-label="Responsável" value={assigneeId} onChange={(id) => setAssigneeId(id)} emptyLabel="Todos os responsáveis" className="w-56" />
        <Select aria-label="Tipo de tarefa" value={typeId} onChange={(e) => setTypeId(e.target.value)} className="w-48">
          <option value="">Todos os tipos</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.active ? "" : " (desativado)"}
            </option>
          ))}
        </Select>
        {sources.map((s) => (
          <label key={s.id} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={!hidden.includes(s.id)} onChange={(e) => setHidden(e.target.checked ? hidden.filter((h) => h !== s.id) : [...hidden, s.id])} />
            {s.label}
          </label>
        ))}
        {typeId && sources.some((s) => s.id === "LEAD_NEXT_ACTION") && <span className="text-xs text-muted-foreground">Com um tipo escolhido, só aparecem tarefas.</span>}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" aria-label="Anterior" onClick={() => setAnchor(move(view, anchor, -1))}>
            ←
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAnchor(new Date())}>
            Hoje
          </Button>
          <Button type="button" variant="outline" size="sm" aria-label="Seguinte" onClick={() => setAnchor(move(view, anchor, 1))}>
            →
          </Button>
        </div>
        <h2 className="text-sm font-semibold first-letter:uppercase">{title(view, range.days, anchor)}</h2>
        <span className="w-28 text-right text-xs text-muted-foreground">{agenda.isFetching ? "A carregar..." : ""}</span>
      </div>
      {agenda.isError && <p className="text-sm text-red-600">Não foi possível carregar a agenda.</p>}

      {view === "month" && (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
          {WEEKDAYS.map((d) => (
            <div key={d} className="bg-muted/50 p-2 text-center font-medium text-muted-foreground">
              {d}
            </div>
          ))}
          {range.days.map((day) => {
            const key = toDayKey(day);
            const list = entriesByDay.get(key) ?? [];
            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                aria-label={`Dia ${key}`}
                onClick={() => canCreate && setCreatingOn(key)}
                className={cn("min-h-24 space-y-1 bg-background p-1.5 hover:bg-muted/30", day.getMonth() !== anchor.getMonth() && "bg-muted/20 text-muted-foreground")}
              >
                <button type="button" className={cn("text-xs hover:underline", key === todayKey && "font-bold text-primary")} onClick={(e) => { e.stopPropagation(); openDay(day); }}>
                  {day.getDate()}
                </button>
                <div className="space-y-0.5">
                  {list.map((entry) => entryButton(entry, true))}
                  {more(day, key, list.length)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "week" && (
        <div className="grid grid-cols-7 gap-2">
          {range.days.map((day, i) => {
            const key = toDayKey(day);
            const list = entriesByDay.get(key) ?? [];
            return (
              <section key={key} aria-label={`Dia ${key}`} className="min-h-64 space-y-1 rounded-md border border-border bg-background p-2">
                <div className="flex items-center justify-between">
                  <button type="button" className={cn("text-xs font-medium hover:underline", key === todayKey && "text-primary")} onClick={() => openDay(day)}>
                    {WEEKDAYS[i]} {day.getDate()}
                  </button>
                  {canCreate && (
                    <button type="button" aria-label={`Nova tarefa em ${key}`} className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setCreatingOn(key)}>
                      +
                    </button>
                  )}
                </div>
                {list.map((entry) => (
                  <div key={`${entry.source}:${entry.id}`} className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">{timeLabel(entry)}</p>
                    {entryButton(entry, true)}
                  </div>
                ))}
                {more(day, key, list.length)}
              </section>
            );
          })}
        </div>
      )}

      {view === "day" && (() => {
        const key = toDayKey(range.days[0]);
        const list = entriesByDay.get(key) ?? [];
        return (
          <div className="space-y-2 rounded-md border border-border bg-background p-3">
            {list.length === 0 && <p className="text-sm text-muted-foreground">Nada marcado para este dia.</p>}
            {list.map((entry) => entryButton(entry, false))}
            {countOf(key) > list.length && <p className="text-xs text-muted-foreground">Há mais {countOf(key) - list.length}: filtra por responsável ou tipo para as ver.</p>}
            {canCreate && (
              <Button type="button" variant="outline" size="sm" onClick={() => setCreatingOn(key)}>
                Nova tarefa neste dia
              </Button>
            )}
          </div>
        );
      })()}

      {opening && Opener && (
        <Suspense fallback={null}>
          <Opener id={opening.id} onClose={() => setOpening(null)} />
        </Suspense>
      )}
      {creatingOn && <TaskDialog open onClose={() => setCreatingOn(null)} defaultDueDate={creatingOn} />}
    </div>
  );
}
