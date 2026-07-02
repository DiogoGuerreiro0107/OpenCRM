import type { Task, TaskPriority, TaskStatus, TaskType, UserSummary } from "@opencrm/shared-types";
import { api } from "./api";

export interface TaskInput {
  title: string;
  description?: string;
  dueDate?: string;
  status?: TaskStatus;
  type?: TaskType;
  priority?: TaskPriority;
  result?: string;
  assigneeId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  reminders?: { remindAt: string; message?: string }[];
}

export interface TaskFilters {
  status?: TaskStatus;
  type?: TaskType;
  priority?: TaskPriority;
  assigneeId?: string;
  companyId?: string;
  contactId?: string;
  from?: string;
  to?: string;
  overdue?: "true";
  dueToday?: "true";
}

export async function listTasks(filters: TaskFilters = {}) {
  const { data } = await api.get<Task[]>("/tasks", { params: filters });
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
