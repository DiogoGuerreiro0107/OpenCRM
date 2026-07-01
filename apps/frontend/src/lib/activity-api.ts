import type { ActivityLog, ActivityType } from "@opencrm/shared-types";
import { api } from "./api";

export interface CreateActivityInput {
  type: ActivityType;
  content: string;
  contactId?: string;
  companyId?: string;
}

export async function createActivity(input: CreateActivityInput) {
  const { data } = await api.post<ActivityLog>("/activity-log", input);
  return data;
}
