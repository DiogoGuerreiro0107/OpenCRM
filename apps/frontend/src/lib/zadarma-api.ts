import type { CallRecord, ZadarmaAccount } from "@opencrm/shared-types";
import { api } from "./api";

export interface SaveZadarmaAccountInput {
  apiKey: string;
  apiSecret: string;
  callerExtension?: string;
  active?: boolean;
}

export async function getZadarmaAccount() {
  const { data } = await api.get<ZadarmaAccount | null>("/zadarma/account");
  return data;
}

export async function saveZadarmaAccount(input: SaveZadarmaAccountInput) {
  const { data } = await api.post<ZadarmaAccount>("/zadarma/account", input);
  return data;
}

export async function makeZadarmaCall(phoneNumber: string, context?: { contactId?: string; companyId?: string; dealId?: string }) {
  await api.post("/zadarma/call", { phoneNumber, ...context });
}

export interface CallRecordFilters {
  contactId?: string;
  companyId?: string;
}

export async function listCallRecords(filters: CallRecordFilters = {}) {
  const { data } = await api.get<CallRecord[]>("/zadarma/calls", { params: filters });
  return data;
}
