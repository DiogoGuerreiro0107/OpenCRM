import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { WorkItemType, WorkflowStepCategory } from "@opencrm/shared-types";
import { addWorkItemTypeWorkflow, removeWorkItemTypeWorkflow } from "@/lib/work-item-types-api";
import {
  addWorkflowStep,
  deleteWorkflowStep,
  getWorkflow,
  reorderWorkflowSteps,
  STEP_CATEGORY_LABELS,
  updateWorkflowStep,
} from "@/lib/workflows-api";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const CATEGORIES = Object.entries(STEP_CATEGORY_LABELS) as [WorkflowStepCategory, string][];

/**
 * Passos de um tipo de tarefa (Fase 2b, docs/plano-fase-2-itens-de-trabalho.md). Sem passos, a tarefa só tem estado.
 * Com passos, o estado vem da categoria do passo: «Por fazer» → Pendente, «Em curso» → Em progresso, etc.
 */
export function WorkItemStepsSection({ type }: { type: WorkItemType }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [newStep, setNewStep] = useState({ name: "", category: "OPEN" as WorkflowStepCategory });
  /** Passo com tarefas a apagar: pergunta-se para onde as mover. */
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(null);
  const [moveTo, setMoveTo] = useState("");

  const workflow = useQuery({
    queryKey: ["workflows", type.workflowId],
    queryFn: () => getWorkflow(type.workflowId!),
    enabled: !!type.workflowId,
  });
  const steps = workflow.data?.steps ?? [];

  const refresh = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ["workflows"] });
    queryClient.invalidateQueries({ queryKey: ["work-item-types"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
  const onError = (fallback: string) => (err: unknown) => setError(errorMessage(err, fallback));

  const give = useMutation({ mutationFn: () => addWorkItemTypeWorkflow(type.id), onSuccess: refresh, onError: onError("Não foi possível dar passos ao tipo.") });
  const takeAway = useMutation({ mutationFn: () => removeWorkItemTypeWorkflow(type.id), onSuccess: refresh, onError: onError("Não foi possível tirar os passos.") });
  const add = useMutation({
    mutationFn: () => addWorkflowStep(type.workflowId!, { name: newStep.name.trim(), category: newStep.category }),
    onSuccess: () => {
      setNewStep({ name: "", category: "OPEN" });
      refresh();
    },
    onError: onError("Não foi possível acrescentar o passo."),
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; category?: WorkflowStepCategory }) => updateWorkflowStep(id, input),
    onSuccess: refresh,
    onError: onError("Não foi possível guardar o passo."),
  });
  const remove = useMutation({
    mutationFn: ({ id, target }: { id: string; target?: string }) => deleteWorkflowStep(id, target),
    onSuccess: () => {
      setDeleting(null);
      setMoveTo("");
      refresh();
    },
    onError: onError("Não foi possível apagar o passo."),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => reorderWorkflowSteps(type.workflowId!, ids),
    onSuccess: refresh,
    onError: onError("Não foi possível reordenar."),
  });
  const move = (index: number, delta: number) => {
    const ids = steps.map((s) => s.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label="Passos">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Passos</h3>
        <Link className="text-xs text-primary hover:underline" to={`/configuracoes/campos-personalizados?entidade=WORK_ITEM&ambito=${encodeURIComponent(type.id)}`}>
          Campos deste tipo
        </Link>
      </div>

      {!type.workflowId ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Sem passos, as tarefas deste tipo só têm estado. Com passos, ganham um quadro por passos e o estado passa a vir do passo.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => give.mutate()} disabled={give.isPending}>
            Dar passos a este tipo
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">A categoria de cada passo decide o estado das tarefas que lá estão.</p>
          {workflow.isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center gap-2 rounded-md border border-border p-2">
              <div className="flex flex-col">
                <button type="button" aria-label={`Subir ${step.name}`} className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={index === 0 || reorder.isPending} onClick={() => move(index, -1)}>
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button type="button" aria-label={`Descer ${step.name}`} className="text-muted-foreground hover:text-foreground disabled:opacity-30" disabled={index === steps.length - 1 || reorder.isPending} onClick={() => move(index, 1)}>
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
              <Input
                aria-label={`Nome do passo ${step.name}`}
                defaultValue={step.name}
                key={`${step.id}-${step.name}`}
                maxLength={80}
                className="flex-1"
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (name && name !== step.name) update.mutate({ id: step.id, name });
                }}
              />
              <Select aria-label={`Categoria do passo ${step.name}`} value={step.category} className="w-32" onChange={(e) => update.mutate({ id: step.id, category: e.target.value as WorkflowStepCategory })}>
                {CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <span className="w-14 text-right text-xs text-muted-foreground" title="Tarefas neste passo">
                {step.itemCount}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Apagar o passo ${step.name}`}
                disabled={steps.length <= 1}
                onClick={() => {
                  setError(null);
                  if (step.itemCount > 0) {
                    setDeleting({ id: step.id, name: step.name, count: step.itemCount });
                    setMoveTo("");
                  } else {
                    remove.mutate({ id: step.id });
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          {deleting && (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" role="alert">
              <p>
                O passo «{deleting.name}» tem <strong>{deleting.count}</strong> tarefa(s). Para o apagar, escolhe para que passo as mover:
              </p>
              <div className="flex items-center gap-2">
                <Select aria-label="Passo de destino" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="flex-1">
                  <option value="">Escolher passo...</option>
                  {steps
                    .filter((s) => s.id !== deleting.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({STEP_CATEGORY_LABELS[s.category]})
                      </option>
                    ))}
                </Select>
                <Button type="button" size="sm" disabled={!moveTo || remove.isPending} onClick={() => remove.mutate({ id: deleting.id, target: moveTo })}>
                  Mover e apagar
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDeleting(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-end gap-2 pt-1">
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-step-name" className="text-xs">
                Novo passo
              </Label>
              <Input id="new-step-name" value={newStep.name} maxLength={80} placeholder="Nome do passo" onChange={(e) => setNewStep({ ...newStep, name: e.target.value })} />
            </div>
            <Select aria-label="Categoria do novo passo" value={newStep.category} className="w-32" onChange={(e) => setNewStep({ ...newStep, category: e.target.value as WorkflowStepCategory })}>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button type="button" size="sm" disabled={!newStep.name.trim() || add.isPending} onClick={() => add.mutate()}>
              + Passo
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={takeAway.isPending}
            onClick={() => {
              if (confirm(`Tirar os passos a «${type.name}»? As tarefas ficam só com o estado (não muda) e os passos são apagados.`)) takeAway.mutate();
            }}
          >
            Tirar os passos
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
