import type { Task, TaskPriority, TaskStatus, UserSummary, Page } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";

export interface TaskInput {
  title: string;
  description?: string;
  dueDate?: string;
  /** Horário marcado (Fase 2d); `null` limpa ao editar. */
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  status?: TaskStatus;
  /** Tipo de tarefa (sem ele, «Tarefa»). */
  typeId?: string;
  /** Passo (só em tipos com passos; decide o estado). */
  stepId?: string;
  priority?: TaskPriority;
  result?: string;
  assigneeId?: string;
  /** `null` desliga (ao editar). */
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string;
  reminders?: { remindAt: string; message?: string }[];
}

export interface TaskFilters {
  status?: TaskStatus;
  typeId?: string;
  stepId?: string;
  priority?: TaskPriority;
  assigneeId?: string;
  companyId?: string;
  contactId?: string;
  from?: string;
  to?: string;
  overdue?: "true";
  dueToday?: "true";
  search?: string;
}

/** Uma página da lista de tarefas (prazo mais próximo primeiro; sem prazo no fim). */
export async function listTasks(filters: TaskFilters & PageParams = {}) {
  const { data } = await api.get<Page<Task>>("/tasks", { params: filters });
  return data;
}

/** Calendário: as primeiras tarefas de cada dia (as que a grelha mostra) e quantas há em cada dia (chave AAAA-MM-DD). */
export interface CalendarTasks {
  items: Task[];
  countsByDay: Record<string, number>;
}

/** Intervalo do calendário (no máximo 62 dias); os dias contam-se no fuso horário do browser. */
export async function listCalendarTasks(range: { from: string; to: string; assigneeId?: string; typeId?: string }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data } = await api.get<CalendarTasks>("/tasks/calendar", { params: { ...range, tz } });
  return data;
}

/** Quadro de um tipo com passos: quantas tarefas há em cada passo, com os mesmos filtros da lista. */
export async function getTaskBoard(filters: TaskFilters & { typeId: string }) {
  const { data } = await api.get<{ stepId: string; count: number }[]>("/tasks/board", { params: filters });
  return data;
}

export async function getTask(id: string) {
  const { data } = await api.get<Task>(`/tasks/${id}`);
  return data;
}

export async function createTask(input: TaskInput) {
  const { data } = await api.post<Task>("/tasks", input);
  return data;
}

export async function updateTask(id: string, input: Partial<TaskInput>) {
  const { data } = await api.patch<Task>(`/tasks/${id}`, input);
  return data;
}

export async function deleteTask(id: string) {
  await api.delete(`/tasks/${id}`);
}

export async function listUsers() {
  const { data } = await api.get<UserSummary[]>("/users");
  return data;
}
