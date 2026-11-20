import { useModuleEnabled } from "@/lib/useModules";
import { SERVICE_TYPE } from "@/lib/service-cases-api";

/**
 * Uma tarefa do tipo «Assistência» abre-se na ficha da assistência (Fase 4a), com o módulo ligado. Dá o caminho da
 * ficha, ou `null` para as outras tarefas (que continuam no diálogo da tarefa).
 */
export function useServiceCaseRoute() {
  const enabled = useModuleEnabled("assistencias");
  return (task: { id: string; typeId: string }) => (enabled && task.typeId === SERVICE_TYPE ? `/assistencias/${task.id}` : null);
}
