import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listWorkItemTypes } from "@/lib/work-item-types-api";
import { TasksListPage } from "./TasksListPage";

/**
 * Página de um tipo de tarefa (/tarefas/tipo/:typeId, Fase 2b): a lista de tarefas só desse tipo e, se tiver passos,
 * o quadro por passos. A lista de tipos é curta e já está em cache (formulários, filtros).
 */
export function WorkItemTypePage() {
  const { typeId = "" } = useParams();
  const { data: types, isLoading } = useQuery({ queryKey: ["work-item-types", "all"], queryFn: () => listWorkItemTypes() });
  const type = types?.find((t) => t.id === typeId);

  if (isLoading) return <p className="text-sm text-muted-foreground">A carregar...</p>;
  if (!type) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Tipo de tarefa não encontrado.</p>
        <Link to="/tarefas" className="text-sm text-primary hover:underline">
          Voltar às tarefas
        </Link>
      </div>
    );
  }
  // `key`: mudar de tipo (ou o tipo ganhar/perder passos) recomeça a página com a vista certa.
  return <TasksListPage key={`${type.id}-${type.workflowId ?? ""}`} fixedType={type} />;
}
