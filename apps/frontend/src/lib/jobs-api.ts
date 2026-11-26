import { api } from "./api";

/** Tarefas agendadas do núcleo (Fase E1.2). Só o Administrador. */
export interface JobView {
  id: string;
  label: string;
  description: string;
  /** Extensão dona (com ela desligada a tarefa não corre); null = núcleo. */
  extension: { id: string; label: string; enabled: boolean } | null;
  scheduleText: string;
  timeoutSeconds: number;
  pauseAfterFailures: number;
  enabled: boolean;
  pausedAt: string | null;
  pausedReason: string | null;
  consecutiveFailures: number;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  running: boolean;
}

export interface JobRun {
  id: string;
  jobId: string;
  trigger: "SCHEDULE" | "MANUAL";
  triggeredBy: { id: string; name: string } | null;
  startedAt: string;
  finishedAt: string;
  status: "SUCCESS" | "FAILED" | "TIMEOUT";
  summary: string | null;
  error: string | null;
}

export interface JobAlert {
  id: string;
  label: string;
  pausedAt: string;
  pausedReason: string | null;
}

export const listJobs = async () => (await api.get<JobView[]>("/jobs")).data;
export const listJobAlerts = async () => (await api.get<JobAlert[]>("/jobs/alerts")).data;
export const listJobRuns = async (id: string) => (await api.get<JobRun[]>(`/jobs/${id}/runs`)).data;
export const runJob = async (id: string) => (await api.post<{ run: JobRun; job: JobView }>(`/jobs/${id}/run`)).data;
export const setJobEnabled = async (id: string, enabled: boolean) => (await api.patch<JobView>(`/jobs/${id}`, { enabled })).data;
export const resumeJob = async (id: string) => (await api.post<JobView>(`/jobs/${id}/resume`)).data;
