import type { AuditPage } from "@opencrm/shared-types";
import { api } from "./api";

export interface AuditFilters {
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

export async function listAudit(filters: AuditFilters, cursor?: string) {
  const params = Object.fromEntries(
    Object.entries({ ...filters, cursor, limit: 50 }).filter(([, v]) => v !== undefined && v !== ""),
  );
  const { data } = await api.get<AuditPage>("/audit", { params });
  return data;
}
