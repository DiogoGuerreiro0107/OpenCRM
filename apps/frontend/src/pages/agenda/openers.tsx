import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useServiceCaseRoute } from "@/lib/useServiceCaseRoute";
import { getTask } from "@/lib/tasks-api";
import { getLead, getLeadSettings } from "@/lib/leads-api";
import { TaskDialog } from "@/pages/tasks/TaskDialog";
import { LeadDialog } from "@/pages/leads/LeadDialog";

/** O que acontece ao abrir uma entrada da agenda, por fonte (registadas em src/modules/, Fase 2d). */
export interface AgendaOpenerProps {
  id: string;
  onClose: () => void;
}

/** Tarefa: o diálogo da tarefa, com os dados atuais; uma assistência abre na ficha (Fase 4a). */
export function TaskOpener({ id, onClose }: AgendaOpenerProps) {
  const { data: task } = useQuery({ queryKey: ["tasks", "one", id], queryFn: () => getTask(id) });
  const navigate = useNavigate();
  const serviceCaseRoute = useServiceCaseRoute();
  const route = task ? serviceCaseRoute(task) : null;
  useEffect(() => {
    if (route) navigate(route);
  }, [route, navigate]);
  if (!task || route) return null;
  return <TaskDialog open task={task} onClose={onClose} />;
}

/** Próxima ação de uma lead: o diálogo da lead. */
export function LeadOpener({ id, onClose }: AgendaOpenerProps) {
  const { data: lead } = useQuery({ queryKey: ["leads", "one", id], queryFn: () => getLead(id) });
  const { data: settings } = useQuery({ queryKey: ["leads", "settings"], queryFn: getLeadSettings });
  if (!lead) return null;
  return <LeadDialog open lead={lead} mode={settings?.mode ?? "BOTH"} onClose={onClose} />;
}
