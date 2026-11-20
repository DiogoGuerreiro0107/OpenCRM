import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Task, TaskPriority, TaskStatus, WorkItemType } from "@opencrm/shared-types";
import { listCalendarTasks, listTasks, type TaskFilters } from "@/lib/tasks-api";
import { LoadMore, useDebounced, usePagedList } from "@/lib/pagination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCanWrite } from "@/lib/useCanWrite";
import { MonthCalendar, monthGridRange } from "@/components/calendar/MonthCalendar";
import { UserPicker } from "@/components/pickers";
import { Select } from "@/components/ui/select";
import { WorkItemTypeBadge } from "@/components/WorkItemTypeBadge";
import { listWorkItemTypes } from "@/lib/work-item-types-api";
import { TaskDialog } from "./TaskDialog";
import { useServiceCaseRoute } from "@/lib/useServiceCaseRoute";
import { WorkItemBoard } from "./WorkItemBoard";
import { TASK_STATUS_LABELS } from "./task-labels";

type TabValue = TaskStatus | "ALL" | "OVERDUE" | "TODAY";

const STATUS_TABS: { value: TabValue; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "PENDING", label: "Pendentes" },
  { value: "IN_PROGRESS", label: "Em progresso" },
  { value: "DONE", label: "Concluídas" },
  { value: "CANCELLED", label: "Canceladas" },
  { value: "OVERDUE", label: "Atrasadas" },
  { value: "TODAY", label: "Hoje" },
];

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  BAIXA: "Baixa",
  NORMAL: "Normal",
  ALTA: "Alta",
  URGENTE: "Urgente",
};

const PRIORITY_BADGE_CLASS: Record<TaskPriority, string> = {
  BAIXA: "",
  NORMAL: "bg-blue-100 text-blue-800 border-blue-200",
  ALTA: "bg-amber-100 text-amber-800 border-amber-200",
  URGENTE: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_BADGE_CLASS: Record<TaskStatus, string> = {
  PENDING: "",
  IN_PROGRESS: "bg-blue-100 text-blue-800 border-blue-200",
  DONE: "bg-green-100 text-green-800 border-green-200",
  CANCELLED: "bg-gray-100 text-gray-600 border-gray-200 line-through",
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Tarefas: lista paginada e calendário. Com `fixedType` (Fase 2b) é a página de um tipo (/tarefas/tipo/:id): só esse
 * tipo e, se tiver passos, também o quadro por passos (a vista por omissão).
 */
export function TasksListPage({ fixedType }: { fixedType?: WorkItemType } = {}) {
  const canCreate = useCanWrite("dailyWork");
  const hasBoard = !!fixedType && fixedType.steps.length > 0;
  const [statusFilter, setStatusFilter] = useState<TabValue>("ALL");
  const [view, setView] = useState<"list" | "calendar" | "board">(hasBoard ? "board" : "list");
  const [month, setMonth] = useState(() => new Date());
  const [dialogState, setDialogState] = useState<{ task: Task | null; defaultDueDate?: string; defaultStepId?: string } | null>(null);
  const navigate = useNavigate();
  const serviceCaseRoute = useServiceCaseRoute();
  /** As assistências abrem na ficha própria (Fase 4a); as outras tarefas, no diálogo. */
  const openTask = (task: Task) => {
    const route = serviceCaseRoute(task);
    if (route) navigate(route);
    else setDialogState({ task });
  };

  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const [assigneeId, setAssigneeId] = useState("");
  const [chosenTypeId, setTypeId] = useState("");
  const typeId = fixedType?.id ?? chosenTypeId;
  // Um tipo que perdeu os passos enquanto se via o quadro volta à lista.
  const currentView = view === "board" && !hasBoard ? "list" : view;
  // Todos os tipos (também os desativados: as tarefas antigas continuam a filtrar-se por eles).
  const { data: types = [] } = useQuery({ queryKey: ["work-item-types", "all"], queryFn: () => listWorkItemTypes() });

  // Lista: paginada, com pesquisa (docs/plano-paginacao-listagens.md).
  const tabFilters: TaskFilters =
    statusFilter === "ALL" ? {} : statusFilter === "OVERDUE" ? { overdue: "true" } : statusFilter === "TODAY" ? { dueToday: "true" } : { status: statusFilter };
  const list = usePagedList(["tasks", "list", statusFilter, term, assigneeId, typeId], (cursor) => listTasks({ ...tabFilters, search: term || undefined, assigneeId: assigneeId || undefined, typeId: typeId || undefined, cursor }), {
    enabled: currentView === "list",
  });
  const tasks = list.items;
  const isLoading = list.isLoading;

  // Calendário: só as tarefas com prazo nas 6 semanas visíveis.
  const range = monthGridRange(month);
  const calendar = useQuery({
    queryKey: ["tasks", "calendar", range.from, range.to, assigneeId, typeId],
    queryFn: () => listCalendarTasks({ ...range, assigneeId: assigneeId || undefined, typeId: typeId || undefined }),
    enabled: currentView === "calendar",
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {fixedType ? (
          <div className="space-y-1">
            <Link to="/tarefas" className="text-xs text-muted-foreground hover:underline">
              ← Todas as tarefas
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <WorkItemTypeBadge type={fixedType} />
            </h1>
          </div>
        ) : (
          <h1 className="text-2xl font-semibold">Tarefas</h1>
        )}
        <div className="flex gap-2">
          <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Vista">
            {([...(hasBoard ? (["board"] as const) : []), "list", "calendar"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={currentView === v}
                onClick={() => setView(v)}
                className={cn("px-3 py-1.5 text-sm", currentView === v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {v === "board" ? "Quadro" : v === "list" ? "Lista" : "Calendário"}
              </button>
            ))}
          </div>
          {canCreate && <Button onClick={() => setDialogState({ task: null })}>{fixedType ? `Nova: ${fixedType.name}` : "Nova tarefa"}</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {currentView !== "calendar" && (
          <Input
            aria-label="Pesquisar tarefas"
            placeholder="Pesquisar por título ou descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
        )}
        <UserPicker aria-label="Responsável" value={assigneeId} onChange={(id) => setAssigneeId(id)} emptyLabel="Todos os responsáveis" className="w-56" />
        {!fixedType && (
          <Select aria-label="Tipo" value={typeId} onChange={(e) => setTypeId(e.target.value)} className="w-48">
            <option value="">Todos os tipos</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.active ? "" : " (desativado)"}
              </option>
            ))}
          </Select>
        )}
        {!fixedType && typeId && (
          <Link to={`/tarefas/tipo/${encodeURIComponent(typeId)}`} className="text-sm text-primary hover:underline">
            Abrir a página deste tipo
          </Link>
        )}
      </div>

      {currentView === "list" && (
        <div className="flex gap-2 border-b border-border">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium",
                tab.value === statusFilter
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {currentView === "board" && fixedType ? (
        <WorkItemBoard
          type={fixedType}
          filters={{ search: term || undefined, assigneeId: assigneeId || undefined }}
          onTaskClick={(task) => openTask(task)}
          onAdd={(stepId) => setDialogState({ task: null, defaultStepId: stepId })}
          readOnly={!canCreate}
        />
      ) : currentView === "calendar" ? (
        <MonthCalendar
          month={month}
          tasks={calendar.data?.items ?? []}
          countsByDay={calendar.data?.countsByDay}
          onMonthChange={setMonth}
          onDayClick={(dayKey) => {
            if (canCreate) setDialogState({ task: null, defaultDueDate: dayKey });
          }}
          onTaskClick={(task) => openTask(task)}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Título</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Prazo</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Prioridade</th>
                <th className="px-4 py-2 font-medium">Responsável</th>
                <th className="px-4 py-2 font-medium">Relacionado com</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    A carregar...
                  </td>
                </tr>
              )}
              {!isLoading && tasks.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    Nenhuma tarefa encontrada.
                  </td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                  onClick={() => openTask(task)}
                >
                  <td className="px-4 py-2 font-medium">{task.title}</td>
                  <td className="px-4 py-2">
                    <WorkItemTypeBadge type={task.type} />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(task.dueDate)}</td>
                  <td className="px-4 py-2">
                    {/* Num tipo com passos mostra-se o passo (a cor continua a ser a do estado). */}
                    <Badge className={STATUS_BADGE_CLASS[task.status]}>{task.step?.name ?? TASK_STATUS_LABELS[task.status]}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge className={PRIORITY_BADGE_CLASS[task.priority]}>{PRIORITY_LABELS[task.priority]}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{task.assignee.name}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {task.company?.name ?? task.contact?.name ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {currentView === "list" && (
        <LoadMore shown={tasks.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["tarefa", "tarefas"]} />
      )}

      {dialogState && (
        <TaskDialog
          open
          onClose={() => setDialogState(null)}
          task={dialogState.task}
          defaultDueDate={dialogState.defaultDueDate}
          defaultTypeId={fixedType?.id}
          defaultStepId={dialogState.defaultStepId}
        />
      )}
    </div>
  );
}
