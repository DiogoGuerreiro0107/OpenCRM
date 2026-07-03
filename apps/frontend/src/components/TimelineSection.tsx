import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import type { TimelineEntityType, TimelineEvent, TimelineEventType } from "@opencrm/shared-types";
import { createTimelineEvent, deleteTimelineEvent, listTimeline, updateTimelineEvent } from "@/lib/timeline-api";
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

function TimelineEntry({
  event,
  entityType,
  entityId,
}: {
  event: TimelineEvent;
  entityType: TimelineEntityType;
  entityId: string;
}) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(event.description ?? "");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["timeline", entityType, entityId] });
  }

  const updateMutation = useMutation({
    mutationFn: () => updateTimelineEvent(event.id, { description: editText.trim() }),
    onSuccess: () => {
      invalidate();
      setIsEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTimelineEvent(event.id),
    onSuccess: invalidate,
  });

  const canEdit = event.type !== "SYSTEM";

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-1 flex items-center justify-between">
        <Badge>{EVENT_LABELS[event.type]}</Badge>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {new Date(event.createdAt).toLocaleString("pt-PT")} · {event.user.name}
          </span>
          {canEdit && !isEditing && (
            <div className="flex gap-1">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setEditText(event.description ?? "");
                  setIsEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-red-600"
                onClick={() => {
                  if (confirm("Eliminar este evento?")) deleteMutation.mutate();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="min-h-[60px]" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={updateMutation.isPending || !editText.trim()}
              onClick={() => updateMutation.mutate()}
            >
              Guardar
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm">{event.description}</p>
      )}
    </div>
  );
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
          <TimelineEntry key={event.id} event={event} entityType={entityType} entityId={entityId} />
        ))}
      </div>
    </div>
  );
}
