import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StartTimerResult, TimeEntry } from "@opencrm/shared-types";
import { useAuth } from "@/lib/AuthContext";
import { useCanWrite } from "@/lib/useCanWrite";
import { LoadMore, usePagedList } from "@/lib/pagination";
import { errorMessage } from "@/lib/errors";
import { formatDuration, getActiveTimer, getTimeSummary, listTimeEntries, startTimer, stopTimer } from "@/lib/time-entries-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteTimeEntryDialog, TimeEntryDialog } from "./TimeEntryDialogs";

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

/**
 * Tempo de um item de trabalho (Fase 4b): iniciar/parar o meu cronómetro, totais (e por pessoa), registos com editar e
 * apagar (pedem motivo quando mudam horas) e registo manual. Usado na ficha da assistência.
 */
export function TimeSection({ workItemId, closed }: { workItemId: string; closed: boolean }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canWrite = useCanWrite("dailyWork");
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit"; entry: TimeEntry } | { kind: "delete"; entry: TimeEntry } | null>(null);

  const active = useQuery({ queryKey: ["time-entries", "active"], queryFn: getActiveTimer, staleTime: 60_000 });
  const summary = useQuery({ queryKey: ["time-entries", "summary", workItemId], queryFn: () => getTimeSummary(workItemId) });
  const list = usePagedList(["time-entries", "list", workItemId], (cursor) => listTimeEntries({ workItemId, cursor, limit: 10 }));
  const mineHere = active.data?.entry?.workItemId === workItemId;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["time-entries"] });
  const start = useMutation({
    mutationFn: () => startTimer(workItemId),
    onSuccess: (result: StartTimerResult) => {
      const s = result.stopped;
      setNotice(s ? `Parou o cronómetro de ${s.workItem.serviceCaseCode ? `${s.workItem.serviceCaseCode} · ` : ""}${s.workItem.title} (${formatDuration(s.durationSeconds)}).` : null);
      refresh();
    },
  });
  const stop = useMutation({ mutationFn: () => stopTimer(), onSuccess: () => { setNotice(null); refresh(); } });
  const mutationError = start.error ?? stop.error;
  const canChange = (entry: TimeEntry) => canWrite && (entry.user.id === user?.id || user?.role === "ADMINISTRADOR");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canWrite &&
          (mineHere ? (
            <Button variant="outline" onClick={() => stop.mutate()} disabled={stop.isPending}>
              Parar cronómetro
            </Button>
          ) : (
            <Button onClick={() => start.mutate()} disabled={start.isPending || closed} title={closed ? "A tarefa está fechada" : undefined}>
              Iniciar cronómetro
            </Button>
          ))}
        {canWrite && (
          <Button variant="outline" onClick={() => setDialog({ kind: "new" })}>
            Adicionar tempo
          </Button>
        )}
      </div>
      {closed && canWrite && <p className="text-xs text-muted-foreground">A tarefa está fechada: já não se inicia o cronómetro, mas pode-se adicionar tempo.</p>}
      {notice && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{notice}</p>}
      {mutationError && <p className="text-sm text-red-600">{errorMessage(mutationError, "Não foi possível.")}</p>}

      {summary.data && summary.data.totalSeconds > 0 && (
        <div className="text-sm">
          <p>
            <span className="font-medium">Total {formatDuration(summary.data.totalSeconds)}</span>
            <span className="text-muted-foreground"> · faturável {formatDuration(summary.data.billableSeconds)}</span>
          </p>
          <ul className="text-xs text-muted-foreground">
            {summary.data.byUser.map((u) => (
              <li key={u.user.id}>
                {u.user.name}: {formatDuration(u.totalSeconds)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="divide-y divide-border text-sm">
        {list.items.map((e) => (
          <li key={e.id} className="flex flex-wrap items-start gap-x-2 gap-y-1 py-2">
            <div className="min-w-0 flex-1">
              <p>
                <span className="font-medium">{e.user.name}</span>{" "}
                <span className="text-muted-foreground">
                  {dateTime(e.startedAt)}–{e.endedAt ? time(e.endedAt) : "agora"}
                </span>{" "}
                <span className="font-mono text-xs">{formatDuration(e.durationSeconds)}</span>
              </p>
              {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
              {e.editReason && (
                <p className="text-xs text-muted-foreground" title={e.editedAt ? `Acertado em ${dateTime(e.editedAt)}` : undefined}>
                  Acertado por {e.editedBy?.name ?? "?"}: {e.editReason}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {e.running && <Badge className="border-primary/30 bg-primary/10 text-primary">A correr</Badge>}
              {e.manual && <Badge>Manual</Badge>}
              {!e.billable && <Badge>Não faturável</Badge>}
            </div>
            {canChange(e) && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setDialog({ kind: "edit", entry: e })}>
                  Editar
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-red-700" onClick={() => setDialog({ kind: "delete", entry: e })}>
                  Apagar
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!list.isLoading && list.items.length === 0 && <p className="text-sm text-muted-foreground">Ainda sem tempo registado.</p>}
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["registo", "registos"]} />

      {dialog?.kind === "new" && <TimeEntryDialog workItemId={workItemId} onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <TimeEntryDialog workItemId={workItemId} entry={dialog.entry} onClose={() => setDialog(null)} />}
      {dialog?.kind === "delete" && <DeleteTimeEntryDialog entry={dialog.entry} onClose={() => setDialog(null)} />}
    </div>
  );
}
