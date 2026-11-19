import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Deal, StageWithCount } from "@opencrm/shared-types";
import { Button } from "@/components/ui/button";
import { DealCard } from "./DealCard";
import type { ColumnInfo } from "./KanbanBoard";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
}

const STAGE_TYPE_CLASS: Record<StageWithCount["type"], string> = {
  OPEN: "border-t-border",
  WON: "border-t-green-500",
  LOST: "border-t-red-400",
};

interface StageColumnProps {
  stage: StageWithCount;
  deals: Deal[];
  onAddDeal: () => void;
  /** Sem permissão para criar negócios, o botão "+ Negócio" não aparece. */
  canAddDeal?: boolean;
  onDealClick: (deal: Deal) => void;
  /** Número e valor da coluna inteira (servidor) e se há mais cartões por carregar. */
  info?: ColumnInfo;
  onLoadMore: () => void;
  /** Cartões não arrastáveis (sem permissão, ou pesquisa ativa). */
  dragDisabled?: boolean;
}

export function StageColumn({ stage, deals, onAddDeal, onDealClick, canAddDeal = true, info, onLoadMore, dragDisabled = false }: StageColumnProps) {
  const { setNodeRef } = useDroppable({ id: stage.id });
  // Totais da coluna inteira (vêm do servidor): os cartões carregados podem ser só o início dela.
  const count = info?.total ?? deals.length;
  const total = info?.totalValue ?? deals.reduce((sum, deal) => sum + deal.value, 0);

  return (
    <div
      className={`flex w-72 shrink-0 flex-col rounded-md border-t-4 bg-muted/30 ${STAGE_TYPE_CLASS[stage.type]}`}
    >
      <div className="space-y-0.5 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{stage.name}</h3>
          <span className="text-xs text-muted-foreground">{count}</span>
        </div>
        <p className="text-xs text-muted-foreground">{formatCurrency(total)}</p>
      </div>

      <div ref={setNodeRef} className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy} disabled={dragDisabled}>
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} onClick={() => onDealClick(deal)} />
          ))}
        </SortableContext>
        {info?.hasMore && (
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={onLoadMore} disabled={info.loadingMore}>
            {info.loadingMore ? "A carregar..." : `Mostrar mais (${Math.max(0, count - deals.length)} por mostrar)`}
          </Button>
        )}
      </div>

      {canAddDeal && (
        <div className="p-2">
          <Button variant="outline" size="sm" className="w-full" onClick={onAddDeal}>
            + Negócio
          </Button>
        </div>
      )}
    </div>
  );
}
