import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Task, TaskPriority, TaskStatus } from "@opencrm/shared-types";
import { listTasks } from "@/lib/tasks-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MonthCalendar } from "@/components/calendar/MonthCalendar";
import { TaskDialog } from "./TaskDialog";

type TabValue = TaskStatus | "ALL" | "OVERDUE" | "TODAY";

const STATUS_TABS: { value: TabValue; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "PENDING", label: "Pendentes" },
  { value: "IN_PROGRESS", label: "Em progresso" },
  { value: "DONE", label: "Concluídas" },
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
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em progresso",
  DONE: "Concluída",
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
}

export function TasksListPage() {
  const [statusFilter, setStatusFilter] = useState<TabValue>("ALL");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [month, setMonth] = useState(() => new Date());
  const [dialogState, setDialogState] = useState<{ task: Task | null; defaultDueDate?: string } | null>(null);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", statusFilter],
    queryFn: () => {
      if (statusFilter === "ALL") return listTasks({});
      if (statusFilter === "OVERDUE") return listTasks({ overdue: "true" });
      if (statusFilter === "TODAY") return listTasks({ dueToday: "true" });
      return listTasks({ status: statusFilter });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tarefas</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setView(view === "list" ? "calendar" : "list")}
          >
            {view === "list" ? "Ver calendário" : "Ver lista"}
          </Button>
          <Button onClick={() => setDialogState({ task: null })}>Nova tarefa</Button>
        </div>
      </div>

      {view === "list" && (
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

      {view === "calendar" ? (
        <MonthCalendar
          month={month}
          tasks={tasks ?? []}
          onMonthChange={setMonth}
          onDayClick={(dayKey) => setDialogState({ task: null, defaultDueDate: dayKey })}
          onTaskClick={(task) => setDialogState({ task })}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Título</th>
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
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    A carregar...
                  </td>
                </tr>
              )}
              {!isLoading && tasks?.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    Nenhuma tarefa encontrada.
                  </td>
                </tr>
              )}
              {tasks?.map((task) => (
                <tr
                  key={task.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                  onClick={() => setDialogState({ task })}
                >
                  <td className="px-4 py-2 font-medium">{task.title}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(task.dueDate)}</td>
                  <td className="px-4 py-2">
                    <Badge className={STATUS_BADGE_CLASS[task.status]}>{STATUS_LABELS[task.status]}</Badge>
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

      {dialogState && (
        <TaskDialog
          open
          onClose={() => setDialogState(null)}
          task={dialogState.task}
          defaultDueDate={dialogState.defaultDueDate}
        />
      )}
    </div>
  );
}
