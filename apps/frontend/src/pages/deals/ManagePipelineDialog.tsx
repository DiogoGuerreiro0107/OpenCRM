import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { PipelineWithStages, StageType } from "@opencrm/shared-types";
import {
  addStage,
  deletePipeline,
  deleteStage,
  reorderStages,
  updatePipeline,
  updateStage,
} from "@/lib/pipelines-api";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const STAGE_TYPE_LABELS: Record<StageType, string> = {
  OPEN: "Aberta",
  WON: "Ganha",
  LOST: "Perdida",
};

interface ManagePipelineDialogProps {
  open: boolean;
  onClose: () => void;
  pipeline: PipelineWithStages;
  onDeleted: () => void;
}

export function ManagePipelineDialog({ open, onClose, pipeline, onDeleted }: ManagePipelineDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(pipeline.name);
  const [newStageName, setNewStageName] = useState("");
  const [newStageType, setNewStageType] = useState<StageType>("OPEN");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(pipeline.name);
      setError(null);
    }
  }, [open, pipeline]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["pipelines"] });
  }

  const renameMutation = useMutation({
    mutationFn: () => updatePipeline(pipeline.id, name.trim()),
    onSuccess: invalidate,
  });

  const deletePipelineMutation = useMutation({
    mutationFn: () => deletePipeline(pipeline.id),
    onSuccess: () => {
      invalidate();
      onDeleted();
      onClose();
    },
    onError: () => setError("Não foi possível eliminar o funil. Move ou elimina os negócios associados primeiro."),
  });

  const addStageMutation = useMutation({
    mutationFn: () => addStage(pipeline.id, { name: newStageName.trim(), type: newStageType }),
    onSuccess: () => {
      invalidate();
      setNewStageName("");
      setNewStageType("OPEN");
    },
  });

  const updateStageMutation = useMutation({
    mutationFn: ({ stageId, name: stageName, type }: { stageId: string; name?: string; type?: StageType }) =>
      updateStage(stageId, { name: stageName, type }),
    onSuccess: invalidate,
  });

  const deleteStageMutation = useMutation({
    mutationFn: (stageId: string) => deleteStage(stageId),
    onSuccess: invalidate,
    onError: () => setError("Não foi possível eliminar a fase. Move ou elimina os negócios desta fase primeiro."),
  });

  const reorderMutation = useMutation({
    mutationFn: (stages: { id: string; order: number }[]) => reorderStages(pipeline.id, stages),
    onSuccess: invalidate,
  });

  const sortedStages = [...pipeline.stages].sort((a, b) => a.order - b.order);

  function moveStage(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sortedStages.length) return;
    const reordered = [...sortedStages];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    reorderMutation.mutate(reordered.map((s, i) => ({ id: s.id, order: i })));
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Gerir funil</DialogTitle>
      </DialogHeader>
      <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-1">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            renameMutation.mutate();
          }}
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="pipeline-name">Nome do funil</Label>
            <Input id="pipeline-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <Button type="submit" size="sm" disabled={renameMutation.isPending || !name.trim()}>
            Guardar
          </Button>
        </form>

        <div className="space-y-2">
          <Label>Fases</Label>
          <div className="space-y-2">
            {sortedStages.map((stage, index) => (
              <div key={stage.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                <div className="flex flex-col">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => moveStage(index, -1)}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                    disabled={index === sortedStages.length - 1}
                    onClick={() => moveStage(index, 1)}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                </div>
                <Input
                  defaultValue={stage.name}
                  className="flex-1"
                  onBlur={(e) => {
                    if (e.target.value.trim() && e.target.value !== stage.name) {
                      updateStageMutation.mutate({ stageId: stage.id, name: e.target.value.trim() });
                    }
                  }}
                />
                <Select
                  value={stage.type}
                  className="w-28"
                  onChange={(e) =>
                    updateStageMutation.mutate({ stageId: stage.id, type: e.target.value as StageType })
                  }
                >
                  {Object.entries(STAGE_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    deleteStageMutation.mutate(stage.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <form
            className="flex items-end gap-2 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (newStageName.trim()) addStageMutation.mutate();
            }}
          >
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-stage-name" className="text-xs">
                Nova fase
              </Label>
              <Input
                id="new-stage-name"
                value={newStageName}
                onChange={(e) => setNewStageName(e.target.value)}
                placeholder="Nome da fase"
              />
            </div>
            <Select
              value={newStageType}
              className="w-28"
              onChange={(e) => setNewStageType(e.target.value as StageType)}
            >
              {Object.entries(STAGE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm" disabled={addStageMutation.isPending || !newStageName.trim()}>
              + Fase
            </Button>
          </form>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-between border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setError(null);
              if (confirm(`Eliminar o funil "${pipeline.name}"? Esta ação não pode ser desfeita.`)) {
                deletePipelineMutation.mutate();
              }
            }}
          >
            Eliminar funil
          </Button>
          <Button type="button" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
