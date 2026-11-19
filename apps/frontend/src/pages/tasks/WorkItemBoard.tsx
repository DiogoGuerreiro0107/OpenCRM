import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type { Task, WorkItemStep, WorkItemType } from "@opencrm/shared-types";
import { getTaskBoard, listTasks, updateTask, type TaskFilters } from "@/lib/tasks-api";
import { STEP_CATEGORY_LABELS } from "@/lib/workflows-api";
import { usePagedList } from "@/lib/pagination";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CATEGORY_BORDER: Record<WorkItemStep["category"], string> = {
  OPEN: "border-t-border",
  IN_PROGRESS: "border-t-blue-400",
  DONE: "border-t-green-500",
  CANCELLED: "border-t-gray-400",
};

/** Cartões por coluna em cada página (como no quadro dos negócios). */
const COLUMN_PAGE = 20;

function formatDue(iso: string | null) {
  if (!iso) return "Sem prazo";
  return new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
}

interface WorkItemBoardProps {
  type: WorkItemType;
  /** Filtros da página (pesquisa, responsável), os mesmos da lista. */
  filters: Pick<TaskFilters, "search" | "assigneeId">;
  onTaskClick: (task: Task) => void;
  onAdd?: (stepId: string) => void;
  /** Sem permissão para alterar tarefas: não se arrasta (consultar continua). */
  readOnly?: boolean;
}

/**
 * Quadro de um tipo com passos (Fase 2b): uma coluna por passo; arrastar um cartão muda o passo (e o estado). Dentro
 * da coluna a ordem é a do prazo, sem ordem manual. Cada coluna pagina à parte («Mostrar mais»).
 */
export function WorkItemBoard({ type, filters, onTaskClick, onAdd, readOnly = false }: WorkItemBoardProps) {
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const counts = useQuery({
    queryKey: ["tasks", "board", type.id, filters.search, filters.assigneeId],
    queryFn: () => getTaskBoard({ typeId: type.id, ...filters }),
  });
  const countOf = new Map((counts.data ?? []).map((c) => [c.stepId, c.count]));

  const move = useMutation({
    mutationFn: ({ task, stepId }: { task: Task; stepId: string }) => updateTask(task.id, { stepId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });

  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);
    const task = event.active.data.current?.task as Task | undefined;
    const stepId = event.over ? String(event.over.id) : null;
    if (task && stepId && stepId !== task.stepId) move.mutate({ task, stepId });
  }

  return (
    <div className="space-y-2">
      {move.isError && <p className="text-sm text-red-600">{errorMessage(move.error, "Não foi possível mudar o passo.")}</p>}
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setDragging((e.active.data.current?.task as Task) ?? null)}
        onDragCancel={() => setDragging(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {type.steps.map((step) => (
            <StepColumn
              key={step.id}
              type={type}
              step={step}
              filters={filters}
              total={countOf.get(step.id) ?? 0}
              onTaskClick={onTaskClick}
              onAdd={onAdd && !readOnly ? () => onAdd(step.id) : undefined}
              dragDisabled={readOnly || move.isPending}
              pendingTaskId={move.isPending ? move.variables?.task.id : undefined}
            />
          ))}
        </div>
        <DragOverlay>{dragging && <TaskCardView task={dragging} />}</DragOverlay>
      </DndContext>
    </div>
  );
}

interface StepColumnProps {
  type: WorkItemType;
  step: WorkItemStep;
  filters: Pick<TaskFilters, "search" | "assigneeId">;
  total: number;
  onTaskClick: (task: Task) => void;
  onAdd?: () => void;
  dragDisabled: boolean;
  pendingTaskId?: string;
}

function StepColumn({ type, step, filters, total, onTaskClick, onAdd, dragDisabled, pendingTaskId }: StepColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: step.id });
  const column = usePagedList(["tasks", "board-column", type.id, step.id, filters.search, filters.assigneeId], (cursor) =>
    listTasks({ typeId: type.id, stepId: step.id, ...filters, cursor, limit: COLUMN_PAGE }),
  );

  return (
    <section aria-label={`Passo ${step.name}`} className={cn("flex w-72 shrink-0 flex-col rounded-md border-t-4 bg-muted/30", CATEGORY_BORDER[step.category])}>
      <div className="space-y-0.5 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{step.name}</h3>
          <span className="text-xs text-muted-foreground">{total}</span>
        </div>
        <p className="text-xs text-muted-foreground">{STEP_CATEGORY_LABELS[step.category]}</p>
      </div>
      <div ref={setNodeRef} className={cn("min-h-24 flex-1 space-y-2 overflow-y-auto px-2 pb-2", isOver && "bg-primary/5")}>
        {column.items.map((task) => (
          <DraggableTask key={task.id} task={task} onClick={() => onTaskClick(task)} disabled={dragDisabled} pending={task.id === pendingTaskId} />
        ))}
        {column.hasNextPage && (
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => column.fetchNextPage()} disabled={column.isFetchingNextPage}>
            {column.isFetchingNextPage ? "A carregar..." : `Mostrar mais (${Math.max(0, total - column.items.length)} por mostrar)`}
          </Button>
        )}
      </div>
      {onAdd && (
        <div className="p-2">
          <Button variant="outline" size="sm" className="w-full" onClick={onAdd}>
            + {type.name}
          </Button>
        </div>
      )}
    </section>
  );
}

function DraggableTask({ task, onClick, disabled, pending }: { task: Task; onClick: () => void; disabled: boolean; pending: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task }, disabled });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn((isDragging || pending) && "opacity-40")}>
      <TaskCardView task={task} onClick={onClick} />
    </div>
  );
}

function TaskCardView({ task, onClick }: { task: Task; onClick?: () => void }) {
  return (
    <Card className="cursor-pointer space-y-1 p-3 text-sm hover:border-primary/40" onClick={onClick}>
      <p className={cn("font-medium", task.status === "CANCELLED" && "line-through text-muted-foreground")}>{task.title}</p>
      <p className="text-xs text-muted-foreground">{formatDue(task.dueDate)}</p>
      <p className="text-xs text-muted-foreground">
        {task.assignee.name}
        {task.company ? ` · ${task.company.name}` : task.contact ? ` · ${task.contact.name}` : ""}
      </p>
    </Card>
  );
}
