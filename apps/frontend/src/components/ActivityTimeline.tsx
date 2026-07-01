import { useState } from "react";
import type { ActivityLog, ActivityType } from "@opencrm/shared-types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  NOTE: "Nota",
  CALL: "Chamada",
  EMAIL: "Email",
  MEETING: "Reunião",
  FILE: "Ficheiro",
};

interface ActivityTimelineProps {
  activities: ActivityLog[];
  onAdd: (input: { type: ActivityType; content: string }) => Promise<void>;
  isSubmitting?: boolean;
}

export function ActivityTimeline({ activities, onAdd, isSubmitting }: ActivityTimelineProps) {
  const [type, setType] = useState<ActivityType>("NOTE");
  const [content, setContent] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    await onAdd({ type, content: content.trim() });
    setContent("");
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex gap-2">
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as ActivityType)}
            className="w-40"
          >
            {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Textarea
            placeholder="Escreve uma nota, resumo de chamada, email..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[40px] flex-1"
            rows={1}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={isSubmitting || !content.trim()}>
            Adicionar
          </Button>
        </div>
      </form>

      <div className="space-y-3">
        {activities.length === 0 && (
          <p className="text-sm text-muted-foreground">Ainda sem atividade registada.</p>
        )}
        {activities.map((activity) => (
          <div key={activity.id} className="rounded-md border border-border p-3">
            <div className="mb-1 flex items-center justify-between">
              <Badge>{ACTIVITY_LABELS[activity.type]}</Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(activity.createdAt).toLocaleString("pt-PT")} · {activity.author.name}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{activity.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
