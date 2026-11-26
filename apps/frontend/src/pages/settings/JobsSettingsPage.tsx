import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listJobRuns, listJobs, resumeJob, runJob, setJobEnabled, type JobRun, type JobView } from "@/lib/jobs-api";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const dateTime = (value: string | null) => (value ? new Date(value).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "medium" }) : "—");
const duration = (run: JobRun) => {
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} s`;
};

const RUN_STATUS: Record<JobRun["status"], { label: string; className: string }> = {
  SUCCESS: { label: "Correu bem", className: "border-green-200 bg-green-100 text-green-800" },
  FAILED: { label: "Falhou", className: "border-red-200 bg-red-100 text-red-800" },
  TIMEOUT: { label: "Passou o limite", className: "border-red-200 bg-red-100 text-red-800" },
};

/** O estado da tarefa numa etiqueta: em pausa, módulo desligado, desligada, a correr ou ativa. */
function JobState({ job }: { job: JobView }) {
  if (job.pausedAt) return <Badge className="border-amber-300 bg-amber-100 text-amber-900">Em pausa</Badge>;
  if (job.extension && !job.extension.enabled) return <Badge>Módulo desligado</Badge>;
  if (!job.enabled) return <Badge>Desligada</Badge>;
  if (job.running) return <Badge className="border-blue-200 bg-blue-100 text-blue-800">A correr</Badge>;
  return <Badge className="border-green-200 bg-green-100 text-green-800">Ativa</Badge>;
}

function RunsList({ jobId }: { jobId: string }) {
  const { data: runs = [], isLoading } = useQuery({ queryKey: ["jobs", "runs", jobId], queryFn: () => listJobRuns(jobId) });
  if (isLoading) return <p className="text-xs text-muted-foreground">A carregar...</p>;
  if (runs.length === 0) return <p className="text-xs text-muted-foreground">Ainda não há passagens registadas.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 pr-2 font-medium">Início</th>
            <th className="py-1 pr-2 font-medium">Duração</th>
            <th className="py-1 pr-2 font-medium">Resultado</th>
            <th className="py-1 pr-2 font-medium">O quê</th>
            <th className="py-1 font-medium">Como</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-t border-border align-top">
              <td className="whitespace-nowrap py-1 pr-2">{dateTime(run.startedAt)}</td>
              <td className="whitespace-nowrap py-1 pr-2 tabular-nums">{duration(run)}</td>
              <td className="py-1 pr-2">
                <Badge className={RUN_STATUS[run.status].className}>{RUN_STATUS[run.status].label}</Badge>
              </td>
              <td className="min-w-[12rem] py-1 pr-2">{run.error ? <span className="text-red-700">{run.error}</span> : (run.summary ?? "—")}</td>
              <td className="whitespace-nowrap py-1">{run.trigger === "MANUAL" ? `À mão${run.triggeredBy ? ` (${run.triggeredBy.name})` : ""}` : "Automática"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobCard({ job }: { job: JobView }) {
  const queryClient = useQueryClient();
  const [showRuns, setShowRuns] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["jobs"] });
  const run = useMutation({ mutationFn: () => runJob(job.id), onSuccess: refresh });
  const toggle = useMutation({ mutationFn: () => setJobEnabled(job.id, !job.enabled), onSuccess: refresh });
  const resume = useMutation({ mutationFn: () => resumeJob(job.id), onSuccess: refresh });
  const error = run.error ?? toggle.error ?? resume.error;
  const moduleOff = !!job.extension && !job.extension.enabled;

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-medium">{job.label}</h2>
              <JobState job={job} />
            </div>
            <p className="text-sm text-muted-foreground">{job.description}</p>
            <p className="text-xs text-muted-foreground">
              {job.scheduleText} · {job.extension ? `módulo ${job.extension.label}` : "núcleo"} · limite {job.timeoutSeconds} s · pausa ao fim de{" "}
              {job.pauseAfterFailures} {job.pauseAfterFailures === 1 ? "falha" : "falhas"} seguidas
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {job.pausedAt && (
              <Button size="sm" disabled={resume.isPending} onClick={() => resume.mutate()}>
                Retomar
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={run.isPending || moduleOff || job.running} onClick={() => run.mutate()}>
              {run.isPending ? "A correr..." : "Correr agora"}
            </Button>
            <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {job.enabled ? "Desligar" : "Ligar"}
            </Button>
          </div>
        </div>
        {job.pausedAt && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Em pausa desde {dateTime(job.pausedAt)}: {job.pausedReason}. Não corre sozinha até a retomares (ou até correr bem à mão).
          </p>
        )}
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Última passagem</dt>
            <dd>{dateTime(job.lastRunAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Último sucesso</dt>
            <dd>{dateTime(job.lastSuccessAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Falhas seguidas</dt>
            <dd>{job.consecutiveFailures}</dd>
          </div>
        </dl>
        {job.lastError && job.consecutiveFailures > 0 && (
          <p className="text-xs text-red-700">
            Último erro ({dateTime(job.lastErrorAt)}): {job.lastError}
          </p>
        )}
        {error && <p className="text-xs text-red-600">{errorMessage(error, "Não foi possível.")}</p>}
        {run.data && !run.isPending && (
          <p className="text-xs text-muted-foreground">
            Correu agora: {RUN_STATUS[run.data.run.status].label.toLowerCase()}
            {run.data.run.summary ? ` · ${run.data.run.summary}` : ""}
            {run.data.run.error ? ` · ${run.data.run.error}` : ""}
          </p>
        )}
        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setShowRuns((v) => !v)}>
          {showRuns ? "Esconder as últimas passagens" : "Ver as últimas passagens"}
        </button>
        {showRuns && <RunsList jobId={job.id} />}
      </CardContent>
    </Card>
  );
}

/**
 * Configurações > Tarefas agendadas (Fase E1.2): o que o CRM faz sozinho, de quanto em quanto tempo, e se está a
 * correr bem. Uma tarefa que falha várias vezes seguidas fica em pausa e os Administradores veem um aviso.
 */
export function JobsSettingsPage() {
  const { data: jobs = [], isLoading } = useQuery({ queryKey: ["jobs", "list"], queryFn: listJobs });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Tarefas agendadas</h1>
        <p className="text-sm text-muted-foreground">
          O que o CRM faz sozinho, de tempos a tempos. Cada passagem fica registada durante 30 dias (as da entrega de
          webhooks só quando há alguma coisa para entregar). Uma tarefa que falha várias vezes seguidas fica{" "}
          <strong>em pausa</strong> e aparece um aviso a todos os Administradores. As tarefas de um módulo desligado não
          correm.
        </p>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}
      <div className="space-y-3">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </div>
  );
}
