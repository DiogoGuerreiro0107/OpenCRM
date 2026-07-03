import type { TimelineEntityType, TimelineEvent, TimelineEventType } from "@opencrm/shared-types";
import { api } from "./api";

export interface CreateTimelineEventInput {
  entityType: TimelineEntityType;
  entityId: string;
  type: TimelineEventType;
  description: string;
}

export async function listTimeline(entityType: TimelineEntityType, entityId: string) {
  const { data } = await api.get<TimelineEvent[]>("/timeline", { params: { entityType, entityId } });
  return data;
}

export async function createTimelineEvent(input: CreateTimelineEventInput) {
  const { data } = await api.post<TimelineEvent>("/timeline", input);
  return data;
}

export async function updateTimelineEvent(id: string, input: { type?: TimelineEventType; description?: string }) {
  const { data } = await api.patch<TimelineEvent>(`/timeline/${id}`, input);
  return data;
}

export async function deleteTimelineEvent(id: string) {
  await api.delete(`/timeline/${id}`);
}
