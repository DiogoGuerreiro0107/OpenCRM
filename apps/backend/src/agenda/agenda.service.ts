import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { dayIn, isTimeZone, isUnknownTimeZoneError } from "../common/time-zone";
import { AGENDA_SOURCE_IDS, AGENDA_SOURCES, AgendaEntry, AgendaSource, AgendaSourceId } from "./agenda-sources";
import { AGENDA_MAX_DAYS, QueryAgendaDto } from "./agenda.dto";

/** Ordem dentro de um dia: dia inteiro primeiro, depois pela hora; empate pelo título. */
function byTime(a: AgendaEntry, b: AgendaEntry) {
  if ((a.kind === "date") !== (b.kind === "date")) return a.kind === "date" ? -1 : 1;
  return a.start.localeCompare(b.start) || a.title.localeCompare(b.title, "pt");
}

/** Agenda (Fase 2d): junta as fontes registadas (tarefas, próxima ação das leads...) num intervalo. */
@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
  ) {}

  /** Fontes que entram: as pedidas (ou todas), sem as de módulos desligados nem, com filtro por tipo, as que não são tarefas. */
  sourcesFor(query: Pick<QueryAgendaDto, "sources" | "typeId">): AgendaSourceId[] {
    return (query.sources?.length ? query.sources : AGENDA_SOURCE_IDS).filter((id) => {
      const source: AgendaSource = AGENDA_SOURCES[id];
      if (source.module && !this.modules.isEnabled(source.module)) return false;
      return !query.typeId || source.filtersByType;
    });
  }

  async find(query: QueryAgendaDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days < 0 || days > AGENDA_MAX_DAYS) {
      throw new BadRequestException(`O intervalo da agenda tem de ter entre 0 e ${AGENDA_MAX_DAYS} dias`);
    }
    const tz = query.tz ?? "UTC";
    if (!isTimeZone(tz)) throw new BadRequestException("Fuso horário desconhecido");
    const perDay = query.perDay ?? 3;
    const sources = this.sourcesFor(query);
    const q = { from, to, fromDay: dayIn(from, tz), toDay: dayIn(to, tz), tz, perDay, assigneeId: query.assigneeId, typeId: query.typeId };

    const results = await Promise.all(sources.map((id) => (AGENDA_SOURCES[id] as AgendaSource).fetch(this.prisma, q))).catch((err: unknown) => {
      if (isUnknownTimeZoneError(err)) throw new BadRequestException("Fuso horário desconhecido");
      throw err;
    });

    // Junta por dia: as contagens somam-se; das entradas ficam as primeiras `perDay` de cada dia, pela hora.
    const countsByDay: Record<string, number> = {};
    const byDay = new Map<string, AgendaEntry[]>();
    for (const result of results) {
      for (const [day, n] of Object.entries(result.countsByDay)) countsByDay[day] = (countsByDay[day] ?? 0) + n;
      for (const entry of result.entries) byDay.set(entry.day, [...(byDay.get(entry.day) ?? []), entry]);
    }
    const entries = [...byDay.keys()].sort().flatMap((day) => byDay.get(day)!.sort(byTime).slice(0, perDay));
    return { sources, entries, countsByDay };
  }
}
