import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Deal } from "@opencrm/shared-types";
import { listPipelines } from "@/lib/pipelines-api";
import { getDealSummary, listDeals, moveDeal, type DealBoardFilters } from "@/lib/deals-api";
import { useDebounced } from "@/lib/pagination";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { ADMIN_ONLY, hasRole } from "@/lib/permissions";
import { useCanWrite } from "@/lib/useCanWrite";
import { KanbanBoard, type ColumnInfo } from "@/components/kanban/KanbanBoard";
import { DealDialog } from "@/components/kanban/DealDialog";
import { NewPipelineDialog } from "./NewPipelineDialog";
import { ManagePipelineDialog } from "./ManagePipelineDialog";

/** Cartões carregados de cada vez numa coluna (docs/plano-paginacao-listagens.md). */
const COLUMN_PAGE = 30;

/** Os primeiros `count` cartões de uma coluna (o início da coluna, pela ordem dela), em páginas de até 100. */
async function fetchColumn(filters: DealBoardFilters, stageId: string, count: number) {
  const deals: Deal[] = [];
  let cursor: string | null = null;
  do {
    const page = await listDeals({ ...filters, stageId, cursor, limit: Math.min(100, count - deals.length) });
    deals.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor && deals.length < count);
  return { deals, hasMore: cursor !== null };
}

export function DealsBoardPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Só o Administrador altera a estrutura dos funis (o backend também o exige).
  const canManagePipelines = hasRole(user?.role, ADMIN_ONLY);
  const canWriteDeals = useCanWrite("deals");
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

  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  // Quantos cartões mostrar em cada coluna (cresce com «Mostrar mais»; volta ao início ao mudar de funil ou pesquisa).
  const [wanted, setWanted] = useState<Record<string, number>>({});
  useEffect(() => setWanted({}), [pipelineId, term]);

  const pipeline = pipelines?.find((p) => p.id === pipelineId);
  const filters: DealBoardFilters = { pipelineId: pipelineId ?? "", search: term || undefined };
  const columns = useQueries({
    queries: (pipeline?.stages ?? []).map((stage) => {
      const count = wanted[stage.id] ?? COLUMN_PAGE;
      return {
        queryKey: ["deals", pipelineId, "column", stage.id, term, count],
        queryFn: () => fetchColumn(filters, stage.id, count),
        placeholderData: keepPreviousData,
      };
    }),
  });
  const { data: summary } = useQuery({
    queryKey: ["deals", pipelineId, "summary", term],
    queryFn: () => getDealSummary(filters),
    enabled: !!pipelineId,
  });
  const loaded = !!pipeline && columns.length === pipeline.stages.length && columns.every((c) => c.data);
  const deals = loaded ? columns.flatMap((c) => c.data!.deals) : null;
  const columnInfo: Record<string, ColumnInfo> = {};
  pipeline?.stages.forEach((stage, i) => {
    const s = summary?.find((x) => x.stageId === stage.id);
    columnInfo[stage.id] = {
      total: s?.count ?? 0,
      totalValue: s?.totalValue ?? 0,
      hasMore: !!columns[i]?.data?.hasMore,
      loadingMore: columns[i]?.isFetching ?? false,
    };
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

  if (isLoadingPipelines) return <p className="text-muted-foreground">A carregar...</p>;

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Funis de vendas</h1>
        {canManagePipelines && (
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
        )}
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

      {pipeline && (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            aria-label="Pesquisar negócios"
            placeholder="Pesquisar negócio, empresa ou contacto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          {term && canWriteDeals && (
            <p className="text-sm text-muted-foreground">Com a pesquisa ativa os cartões não se arrastam (limpa a pesquisa para os mover).</p>
          )}
        </div>
      )}

      {pipeline && deals && (
        <KanbanBoard
          readOnly={!canWriteDeals}
          dragDisabled={!!term}
          columns={columnInfo}
          onLoadMore={(stageId) => setWanted((prev) => ({ ...prev, [stageId]: (prev[stageId] ?? COLUMN_PAGE) + COLUMN_PAGE }))}
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
