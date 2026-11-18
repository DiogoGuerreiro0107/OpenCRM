import { TaskPriority, TaskStatus, TaskType } from "@prisma/client";
import { IsBooleanString, IsDateString, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Filtros da lista paginada de tarefas (`limit`/`cursor` vêm de PageQueryDto). */
export class QueryTasksDto extends PageQueryDto {
  /** Contém (título ou descrição), sem acentos. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskType)
  type?: TaskType;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsBooleanString()
  overdue?: string;

  @IsOptional()
  @IsBooleanString()
  dueToday?: string;
}

/**
 * Calendário: só o intervalo visível (obrigatório, no máximo CALENDAR_MAX_DAYS dias). Devolve no máximo
 * CALENDAR_PER_DAY tarefas por dia (as que a grelha mostra) e quantas há em cada dia, no fuso `tz` do browser.
 */
export class QueryTaskCalendarDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  /** Fuso horário IANA do browser (ex.: Europe/Lisbon), para os dias baterem com a grelha. Por omissão, UTC. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;
}
