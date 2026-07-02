import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Deal, StageWithCount } from "@opencrm/shared-types";
import { Button } from "@/components/ui/button";
import { DealCard } from "./DealCard";

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
  onDealClick: (deal: Deal) => void;
}

export function StageColumn({ stage, deals, onAddDeal, onDealClick }: StageColumnProps) {
  const { setNodeRef } = useDroppable({ id: stage.id });
  const total = deals.reduce((sum, deal) => sum + deal.value, 0);

  return (
    <div
      className={`flex w-72 shrink-0 flex-col rounded-md border-t-4 bg-muted/30 ${STAGE_TYPE_CLASS[stage.type]}`}
    >
      <div className="space-y-0.5 p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{stage.name}</h3>
          <span className="text-xs text-muted-foreground">{deals.length}</span>
        </div>
        <p className="text-xs text-muted-foreground">{formatCurrency(total)}</p>
      </div>

      <div ref={setNodeRef} className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map((deal) => (
            <DealCard key={deal.id} deal={deal} onClick={() => onDealClick(deal)} />
          ))}
        </SortableContext>
      </div>

      <div className="p-2">
        <Button variant="outline" size="sm" className="w-full" onClick={onAddDeal}>
          + Negócio
        </Button>
      </div>
    </div>
  );
}
