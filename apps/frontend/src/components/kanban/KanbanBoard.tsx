import { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Deal, StageWithCount } from "@opencrm/shared-types";
import { StageColumn } from "./StageColumn";
import { DealCard } from "./DealCard";

type Columns = Record<string, string[]>;

function buildColumns(stages: StageWithCount[], deals: Deal[]): Columns {
  const columns: Columns = Object.fromEntries(stages.map((s) => [s.id, [] as string[]]));
  const sorted = [...deals].sort((a, b) => a.order - b.order);
  for (const deal of sorted) {
    if (columns[deal.stageId]) columns[deal.stageId].push(deal.id);
  }
  return columns;
}

interface KanbanBoardProps {
  stages: StageWithCount[];
  deals: Deal[];
  onAddDeal: (stageId: string) => void;
  onDealClick: (deal: Deal) => void;
  onMove: (dealId: string, stageId: string, index: number) => void;
}

export function KanbanBoard({ stages, deals, onAddDeal, onDealClick, onMove }: KanbanBoardProps) {
  const dealsById = Object.fromEntries(deals.map((d) => [d.id, d]));
  const [columns, setColumns] = useState<Columns>(() => buildColumns(stages, deals));
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setColumns(buildColumns(stages, deals));
  }, [stages, deals]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function findContainer(id: string): string | undefined {
    if (columns[id]) return id;
    return Object.keys(columns).find((stageId) => columns[stageId].includes(id));
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(String(active.id));
    const overContainer = findContainer(String(over.id));
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    setColumns((prev) => {
      const activeItems = prev[activeContainer].filter((id) => id !== active.id);
      const overIndex = prev[overContainer].indexOf(String(over.id));
      const insertAt = overIndex >= 0 ? overIndex : prev[overContainer].length;
      const overItems = [...prev[overContainer]];
      overItems.splice(insertAt, 0, String(active.id));
      return { ...prev, [activeContainer]: activeItems, [overContainer]: overItems };
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const container = findContainer(String(active.id));
    if (!container) return;

    const items = columns[container];
    const oldIndex = items.indexOf(String(active.id));
    const overIndex = items.indexOf(String(over.id));
    const newIndex = overIndex >= 0 ? overIndex : items.length - 1;

    if (oldIndex !== newIndex) {
      setColumns((prev) => {
        const reordered = [...items];
        reordered.splice(oldIndex, 1);
        reordered.splice(newIndex, 0, String(active.id));
        return { ...prev, [container]: reordered };
      });
    }

    onMove(String(active.id), container, newIndex);
  }

  const activeDeal = activeId ? dealsById[activeId] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            deals={(columns[stage.id] ?? []).map((id) => dealsById[id]).filter(Boolean)}
            onAddDeal={() => onAddDeal(stage.id)}
            onDealClick={onDealClick}
          />
        ))}
      </div>
      <DragOverlay>{activeDeal && <DealCard deal={activeDeal} onClick={() => {}} />}</DragOverlay>
    </DndContext>
  );
}
