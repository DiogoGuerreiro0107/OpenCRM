import type { Page, TimelineEntityType, TimelineEvent, TimelineEventType } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";

export interface CreateTimelineEventInput {
  entityType: TimelineEntityType;
  entityId: string;
  type: TimelineEventType;
  description: string;
}

/** Uma página do histórico do registo (mais recente primeiro). */
export async function listTimeline(entityType: TimelineEntityType, entityId: string, page: PageParams = {}) {
  const { data } = await api.get<Page<TimelineEvent>>("/timeline", { params: { entityType, entityId, ...page } });
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
