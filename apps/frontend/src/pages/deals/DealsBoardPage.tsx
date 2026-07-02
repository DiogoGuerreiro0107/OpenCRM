import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Deal } from "@opencrm/shared-types";
import { listPipelines } from "@/lib/pipelines-api";
import { listDeals, moveDeal } from "@/lib/deals-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { DealDialog } from "@/components/kanban/DealDialog";
import { NewPipelineDialog } from "./NewPipelineDialog";
import { ManagePipelineDialog } from "./ManagePipelineDialog";

export function DealsBoardPage() {
  const queryClient = useQueryClient();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [isNewPipelineOpen, setIsNewPipelineOpen] = useState(false);
  const [isManagePipelineOpen, setIsManagePipelineOpen] = useState(false);
  const [dealDialog, setDealDialog] = useState<{ stageId: string; deal: Deal | null } | null>(null);

  const { data: pipelines, isLoading: isLoadingPipelines } = useQuery({
    queryKey: ["pipelines"],
    queryFn: listPipelines,
  });

  useEffect(() => {
    if (!pipelineId && pipelines && pipelines.length > 0) {
      setPipelineId(pipelines[0].id);
    }
  }, [pipelines, pipelineId]);

  const { data: deals } = useQuery({
    queryKey: ["deals", pipelineId],
    queryFn: () => listDeals(pipelineId!),
    enabled: !!pipelineId,
  });

  const moveMutation = useMutation({
    mutationFn: ({ dealId, stageId, index }: { dealId: string; stageId: string; index: number }) =>
      moveDeal(dealId, stageId, index),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals", pipelineId] });
      queryClient.invalidateQueries({ queryKey: ["pipelines"] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["deals", pipelineId] });
    },
  });

  const pipeline = pipelines?.find((p) => p.id === pipelineId);

  if (isLoadingPipelines) return <p className="text-muted-foreground">A carregar...</p>;

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Funis de vendas</h1>
        <div className="flex gap-2">
          {pipeline && (
            <Button variant="outline" onClick={() => setIsManagePipelineOpen(true)}>
              Gerir funil
            </Button>
          )}
          <Button variant="outline" onClick={() => setIsNewPipelineOpen(true)}>
            Novo funil
          </Button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-border">
        {pipelines?.map((p) => (
          <button
            key={p.id}
            onClick={() => setPipelineId(p.id)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              p.id === pipelineId
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {p.name}
          </button>
        ))}
        {pipelines?.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">Ainda não existem funis.</p>
        )}
      </div>

      {moveMutation.isError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Não foi possível mover o negócio. Se a fase de destino for uma fase perdida, abre o negócio e preenche o
          "Motivo de perda" antes de o mover.
        </p>
      )}

      {pipeline && deals && (
        <KanbanBoard
          stages={pipeline.stages}
          deals={deals}
          onAddDeal={(stageId) => setDealDialog({ stageId, deal: null })}
          onDealClick={(deal) => setDealDialog({ stageId: deal.stageId, deal })}
          onMove={(dealId, stageId, index) => moveMutation.mutate({ dealId, stageId, index })}
        />
      )}

      <NewPipelineDialog
        open={isNewPipelineOpen}
        onClose={() => setIsNewPipelineOpen(false)}
        onCreated={(id) => setPipelineId(id)}
      />

      {pipeline && isManagePipelineOpen && (
        <ManagePipelineDialog
          open
          onClose={() => setIsManagePipelineOpen(false)}
          pipeline={pipeline}
          onDeleted={() => setPipelineId(null)}
        />
      )}

      {dealDialog && pipelineId && (
        <DealDialog
          open
          onClose={() => setDealDialog(null)}
          pipelineId={pipelineId}
          stageId={dealDialog.stageId}
          deal={dealDialog.deal}
        />
      )}
    </div>
  );
}
