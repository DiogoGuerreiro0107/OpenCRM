import type { DashboardSummary } from "@opencrm/shared-types";
import { api } from "./api";

export async function getDashboardSummary() {
  const { data } = await api.get<DashboardSummary>("/dashboard/summary");
  return data;
}
