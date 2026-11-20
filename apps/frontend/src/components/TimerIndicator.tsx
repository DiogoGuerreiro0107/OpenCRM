import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Timer } from "lucide-react";
import { formatClock, getActiveTimer, stopTimer } from "@/lib/time-entries-api";
import { errorMessage } from "@/lib/errors";
import { useServiceCaseRoute } from "@/lib/useServiceCaseRoute";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Igual ao servidor (FORGOTTEN_AFTER_HOURS). */
const FORGOTTEN_AFTER_SECONDS = 8 * 3600;

// A tarefa abre-se no diálogo das tarefas, carregado à parte (só quando se clica).
const TaskOpener = lazy(() => import("@/pages/agenda/openers").then((m) => ({ default: m.TaskOpener })));

/** Segundos desde `startedAt`, com o relógio do servidor (o do computador pode estar adiantado ou atrasado). */
function useElapsed(startedAt: string | undefined, serverNow: string | undefined, fetchedAt: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (!startedAt || !serverNow) return 0;
  const offset = new Date(serverNow).getTime() - fetchedAt;
  return (now + offset - new Date(startedAt).getTime()) / 1000;
}

/**
 * Indicador global do cronómetro (Fase 4b), na barra lateral: só aparece com um cronómetro a correr. Mostra o
 * contador e o item (abre a ficha da assistência, ou a tarefa) e deixa parar. A correr há mais de 8 h, avisa.
 */
export function TimerIndicator() {
  const queryClient = useQueryClient();
  const serviceCaseRoute = useServiceCaseRoute();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const active = useQuery({ queryKey: ["time-entries", "active"], queryFn: getActiveTimer, staleTime: 60_000 });
  const entry = active.data?.entry ?? null;
  const elapsed = useElapsed(entry?.startedAt, active.data?.serverNow, active.dataUpdatedAt);
  const stop = useMutation({
    mutationFn: () => stopTimer(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["time-entries"] }),
  });

  if (!entry) return null;
  // Também se passar das 8 h com a página aberta (o servidor só o diz quando se volta a pedir).
  const forgotten = entry.forgotten || elapsed > FORGOTTEN_AFTER_SECONDS;
  const route = serviceCaseRoute(entry.workItem);
  const label = entry.workItem.serviceCaseCode ? `${entry.workItem.serviceCaseCode} · ${entry.workItem.title}` : entry.workItem.title;

  return (
    <div
      role="status"
      aria-label="Cronómetro a correr"
      className={cn("mx-2 mb-2 space-y-1 rounded-md border p-2 text-sm", forgotten ? "border-amber-300 bg-amber-50" : "border-primary/30 bg-primary/5")}
    >
      <div className="flex items-center gap-2">
        <Timer className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-mono tabular-nums">{formatClock(elapsed)}</span>
        <Button size="sm" variant="outline" className="ml-auto h-7 px-2 text-xs" disabled={stop.isPending} onClick={() => stop.mutate()}>
          Parar
        </Button>
      </div>
      {route ? (
        <Link to={route} className="block truncate text-xs text-muted-foreground hover:underline" title={label}>
          {label}
        </Link>
      ) : (
        <button type="button" className="block w-full truncate text-left text-xs text-muted-foreground hover:underline" title={label} onClick={() => setOpenTaskId(entry.workItem.id)}>
          {label}
        </button>
      )}
      {forgotten && (
        <p className="flex items-start gap-1 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />A correr há mais de 8 h. Confirma se ainda estás a trabalhar nisto.
        </p>
      )}
      {stop.isError && <p className="text-xs text-red-600">{errorMessage(stop.error, "Não foi possível parar.")}</p>}
      {openTaskId && (
        <Suspense fallback={null}>
          <TaskOpener id={openTaskId} onClose={() => setOpenTaskId(null)} />
        </Suspense>
      )}
    </div>
  );
}
