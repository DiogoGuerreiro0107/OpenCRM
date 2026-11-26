import type { CallRecord, Page } from "@opencrm/shared-types";
import type { PageParams } from "./pagination";
import { api } from "./api";

export async function makeZadarmaCall(phoneNumber: string, context?: { contactId?: string; companyId?: string; dealId?: string }) {
  await api.post("/zadarma/call", { phoneNumber, ...context });
}

export interface CallRecordFilters {
  contactId?: string;
  companyId?: string;
}

/** Uma página de chamadas (mais recentes primeiro). */
export async function listCallRecords(filters: CallRecordFilters & PageParams = {}) {
  const { data } = await api.get<Page<CallRecord>>("/zadarma/calls", { params: filters });
  return data;
}
