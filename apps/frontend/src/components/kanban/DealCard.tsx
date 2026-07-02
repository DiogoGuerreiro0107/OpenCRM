import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Deal } from "@opencrm/shared-types";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
}

interface DealCardProps {
  deal: Deal;
  onClick: () => void;
}

export function DealCard({ deal, onClick }: DealCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        "cursor-grab space-y-1 p-3 text-sm shadow-sm active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <p className="font-medium">{deal.title}</p>
      <p className="text-muted-foreground">{formatCurrency(deal.value)} · {deal.probability}%</p>
      {(deal.company || deal.contact) && (
        <p className="truncate text-xs text-muted-foreground">
          {deal.company?.name}
          {deal.company && deal.contact && " · "}
          {deal.contact?.name}
        </p>
      )}
    </Card>
  );
}
