import type { AgendaResponse, AgendaSourceId } from "@opencrm/shared-types";
import { api } from "./api";

export interface AgendaQuery {
  from: string;
  to: string;
  /** Entradas por dia (o resto conta-se em `countsByDay`). */
  perDay: number;
  sources?: AgendaSourceId[];
  assigneeId?: string;
  typeId?: string;
}

/** Agenda (Fase 2d): entradas de todas as fontes no intervalo, com os dias no fuso do browser. */
export async function getAgenda({ sources, ...query }: AgendaQuery) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data } = await api.get<AgendaResponse>("/agenda", { params: { ...query, tz, sources: sources?.join(",") || undefined } });
  return data;
}
