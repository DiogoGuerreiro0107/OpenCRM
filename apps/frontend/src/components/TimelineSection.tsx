import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TimelineEntityType, TimelineEventType } from "@opencrm/shared-types";
import { createTimelineEvent, listTimeline } from "@/lib/timeline-api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const EVENT_LABELS: Record<TimelineEventType, string> = {
  NOTE: "Nota",
  CALL: "Chamada",
  EMAIL: "Email",
  MEETING: "Reunião",
  FILE: "Ficheiro",
  SYSTEM: "Sistema",
};

interface TimelineSectionProps {
  entityType: TimelineEntityType;
  entityId: string;
}

export function TimelineSection({ entityType, entityId }: TimelineSectionProps) {
  const queryClient = useQueryClient();
  const { data: events } = useQuery({
    queryKey: ["timeline", entityType, entityId],
    queryFn: () => listTimeline(entityType, entityId),
  });

  const [type, setType] = useState<TimelineEventType>("NOTE");
  const [description, setDescription] = useState("");

  const addMutation = useMutation({
    mutationFn: () => createTimelineEvent({ entityType, entityId, type, description: description.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timeline", entityType, entityId] });
      setDescription("");
    },
  });

  return (
    <div className="space-y-4">
      {/* Não é um <form> propositadamente — este componente é usado dentro de outros
          formulários (ex: LeadDialog), e <form> aninhados são inválidos em HTML: o
          browser associa o botão de submit ao formulário exterior em vez deste. */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <Select value={type} onChange={(e) => setType(e.target.value as TimelineEventType)} className="w-40">
            {Object.entries(EVENT_LABELS)
              .filter(([value]) => value !== "SYSTEM")
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </Select>
          <Textarea
            placeholder="Escreve uma nota, resumo de chamada, email..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-[40px] flex-1"
            rows={1}
          />
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={addMutation.isPending || !description.trim()}
            onClick={() => {
              if (!description.trim()) return;
              addMutation.mutate();
            }}
          >
            Adicionar
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {events?.length === 0 && <p className="text-sm text-muted-foreground">Ainda sem atividade registada.</p>}
        {events?.map((event) => (
          <div key={event.id} className="rounded-md border border-border p-3">
            <div className="mb-1 flex items-center justify-between">
              <Badge>{EVENT_LABELS[event.type]}</Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(event.createdAt).toLocaleString("pt-PT")} · {event.user.name}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{event.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
