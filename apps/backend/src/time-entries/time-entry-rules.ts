import { Prisma, PrismaClient } from "@prisma/client";
import { isTimeZone } from "../common/time-zone";

/**
 * Regras do registo de tempo (Fase 4b, docs/plano-fase-4-assistencias.md) que outros serviços também usam: parar
 * cronómetros (fechar uma tarefa, desativar um utilizador) e apresentar durações e horas.
 */

/** A correr há mais do que isto: o ecrã avisa que pode estar esquecido. */
export const FORGOTTEN_AFTER_HOURS = 8;
/** Um registo (manual ou acertado) tem no máximo isto. */
export const MAX_ENTRY_HOURS = 24;
/** Fuso dos textos da timeline quando o browser não o indica. */
export const DEFAULT_TIME_ZONE = "Europe/Lisbon";

const HOUR_MS = 3600_000;

export function durationSeconds(entry: { startedAt: Date; endedAt: Date | null }, now = new Date()): number {
  return Math.max(0, Math.round(((entry.endedAt ?? now).getTime() - entry.startedAt.getTime()) / 1000));
}

export function isForgotten(entry: { startedAt: Date; endedAt: Date | null }, now = new Date()): boolean {
  return entry.endedAt === null && now.getTime() - entry.startedAt.getTime() > FORGOTTEN_AFTER_HOURS * HOUR_MS;
}

export function exceedsMaxDuration(startedAt: Date, endedAt: Date): boolean {
  return endedAt.getTime() - startedAt.getTime() > MAX_ENTRY_HOURS * HOUR_MS;
}

/** «1h05», «45 min», «0 min». */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}

/** «20/11 10:00–11:30» no fuso indicado (o do browser), ou «20/11 10:00–(a correr)». */
export function formatRange(entry: { startedAt: Date; endedAt: Date | null }, tz?: string): string {
  const timeZone = tz && isTimeZone(tz) ? tz : DEFAULT_TIME_ZONE;
  const day = new Intl.DateTimeFormat("pt-PT", { timeZone, day: "2-digit", month: "2-digit" });
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const end = entry.endedAt ? time.format(entry.endedAt) : "(a correr)";
  return `${day.format(entry.startedAt)} ${time.format(entry.startedAt)}–${end}`;
}

type TimeEntryClient = Pick<PrismaClient, "timeEntry"> | Prisma.TransactionClient;

/**
 * Para os cronómetros a correr que cumpram `where` (fim = `at`, nunca antes do início). Devolve os que parou; quem chama
 * avisa as automações («cronómetro parado») se for caso disso.
 */
export async function stopRunningTimers(prisma: TimeEntryClient, where: Prisma.TimeEntryWhereInput, at = new Date()) {
  const running = await prisma.timeEntry.findMany({ where: { ...where, endedAt: null }, select: { id: true, workItemId: true, userId: true, startedAt: true } });
  const stopped: typeof running = [];
  for (const entry of running) {
    const endedAt = at < entry.startedAt ? entry.startedAt : at;
    // Só se ainda estiver a correr (outro pedido pode tê-lo parado entretanto).
    const { count } = await prisma.timeEntry.updateMany({ where: { id: entry.id, endedAt: null }, data: { endedAt, runningUserId: null } });
    if (count > 0) stopped.push(entry);
  }
  return stopped;
}
