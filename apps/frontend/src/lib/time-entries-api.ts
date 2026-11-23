import type { ActiveTimer, Page, StartTimerResult, TimeEntry, TimeSummary } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";

/** Registo de tempo (Fase 4b). O servidor é a fonte de verdade; o contador no ecrã é só apresentação. */

/** Fuso do browser: as horas que o servidor escreve na timeline batem com as do ecrã. */
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function getActiveTimer() {
  const { data } = await api.get<ActiveTimer>("/time-entries/active");
  return data;
}

export async function startTimer(workItemId: string) {
  const { data } = await api.post<StartTimerResult>("/time-entries/start", { workItemId });
  return data;
}

export async function stopTimer(note?: string) {
  const { data } = await api.post<TimeEntry>("/time-entries/stop", { note });
  return data;
}

export async function listTimeEntries(filters: { workItemId?: string; userId?: string } & PageParams) {
  const { data } = await api.get<Page<TimeEntry>>("/time-entries", { params: filters });
  return data;
}

export async function getTimeSummary(workItemId: string) {
  const { data } = await api.get<TimeSummary>("/time-entries/summary", { params: { workItemId } });
  return data;
}

export async function createTimeEntry(input: { workItemId: string; startedAt: string; endedAt: string; note?: string; billable?: boolean }) {
  const { data } = await api.post<TimeEntry>("/time-entries", input);
  return data;
}

export async function updateTimeEntry(id: string, input: { startedAt?: string; endedAt?: string; note?: string | null; billable?: boolean; reason?: string }) {
  const { data } = await api.patch<TimeEntry>(`/time-entries/${id}`, { ...input, tz: tz() });
  return data;
}

export async function deleteTimeEntry(id: string, reason: string) {
  await api.delete(`/time-entries/${id}`, { data: { reason, tz: tz() } });
}

/** «1:05:09» (contador) ou «1h05» / «45 min» (totais). */
export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}
