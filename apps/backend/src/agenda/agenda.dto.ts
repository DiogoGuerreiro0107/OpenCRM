import { Transform } from "class-transformer";
import { IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { AGENDA_SOURCE_IDS, AgendaSourceId } from "./agenda-sources";

export const AGENDA_MAX_DAYS = 62;
export const AGENDA_MAX_PER_DAY = 50;

/** Agenda: intervalo visível (obrigatório), fuso do browser, entradas por dia e filtros. */
export class QueryAgendaDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  /** Fuso horário IANA do browser (ex.: Europe/Lisbon). Por omissão, UTC. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;

  /** Entradas por dia (o resto conta-se em `countsByDay`): o mês pede 3, a semana 20, o dia 50. */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(AGENDA_MAX_PER_DAY)
  perDay?: number;

  /** Fontes a incluir, separadas por vírgulas (por omissão, todas as disponíveis). */
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.split(",").filter(Boolean) : value))
  @IsArray()
  @IsIn(AGENDA_SOURCE_IDS, { each: true, message: `fonte desconhecida (fontes: ${AGENDA_SOURCE_IDS.join(", ")})` })
  sources?: AgendaSourceId[];

  @IsOptional()
  @IsString()
  assigneeId?: string;

  /** Só tarefas deste tipo (as fontes que não são tarefas não entram). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  typeId?: string;
}
