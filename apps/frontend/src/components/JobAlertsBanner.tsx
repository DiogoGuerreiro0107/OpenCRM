import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { ADMIN_ONLY, hasRole } from "@/lib/permissions";
import { listJobAlerts } from "@/lib/jobs-api";
import { listExtensionAlerts } from "@/lib/extensions-api";

/**
 * Aviso no topo da aplicação, só para os Administradores, quando uma tarefa agendada ficou em pausa por falhar várias
 * vezes seguidas (Fase E1.2). Some quando a tarefa é retomada ou corre bem à mão.
 */
export function JobAlertsBanner() {
  const { user } = useAuth();
  const isAdmin = hasRole(user?.role, ADMIN_ONLY);
  const { data: alerts = [] } = useQuery({ queryKey: ["jobs", "alerts"], queryFn: listJobAlerts, enabled: isAdmin, refetchInterval: 5 * 60_000 });
  const { data: extensionAlerts = [] } = useQuery({ queryKey: ["modules", "extension-alerts"], queryFn: listExtensionAlerts, enabled: isAdmin, refetchInterval: 5 * 60_000 });
  if (!isAdmin || (alerts.length === 0 && extensionAlerts.length === 0)) return null;
  return (
    <>
      {extensionAlerts.length > 0 && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            {extensionAlerts.length === 1 ? (
              <>
                Extensão <strong>{extensionAlerts[0].name}</strong>: {extensionAlerts[0].reason}.
              </>
            ) : (
              <>{extensionAlerts.length} extensões foram desligadas automaticamente: {extensionAlerts.map((a) => a.name).join(", ")}.</>
            )}{" "}
            <Link to="/configuracoes/modulos" className="font-medium underline">
              Ver extensões
            </Link>
          </p>
        </div>
      )}
      {alerts.length > 0 && <JobsAlert alerts={alerts} />}
    </>
  );
}

function JobsAlert({ alerts }: { alerts: Awaited<ReturnType<typeof listJobAlerts>> }) {
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>
        {alerts.length === 1 ? (
          <>
            A tarefa agendada <strong>{alerts[0].label}</strong> está em pausa depois de falhar várias vezes seguidas.
          </>
        ) : (
          <>
            {alerts.length} tarefas agendadas estão em pausa depois de falharem várias vezes seguidas:{" "}
            {alerts.map((a) => a.label).join(", ")}.
          </>
        )}{" "}
        <Link to="/configuracoes/tarefas-agendadas" className="font-medium underline">
          Ver e retomar
        </Link>
      </p>
    </div>
  );
}
