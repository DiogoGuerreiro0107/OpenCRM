import { WorkItemPriority, WorkItemStatus } from "@prisma/client";
import { IsBooleanString, IsDateString, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { IntersectionType, OmitType } from "@nestjs/mapped-types";
import { PageQueryDto } from "../../common/pagination";

/** Filtros comuns à lista paginada e ao quadro por passos. */
export class TaskFiltersDto {
  /** Contém (título ou descrição), sem acentos. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(WorkItemStatus)
  status?: WorkItemStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  typeId?: string;

  /** Passo (coluna do quadro de um tipo com passos). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  stepId?: string;

  @IsOptional()
  @IsEnum(WorkItemPriority)
  priority?: WorkItemPriority;

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

/** Lista paginada de tarefas (`limit`/`cursor` de PageQueryDto, com os filtros de TaskFiltersDto). */
export class QueryTasksDto extends IntersectionType(PageQueryDto, TaskFiltersDto) {}

/** Quadro de um tipo com passos: o tipo é obrigatório. */
export class QueryTaskBoardDto extends OmitType(TaskFiltersDto, ["typeId"] as const) {
  @IsString()
  @MaxLength(64)
  typeId!: string;
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

  @IsOptional()
  @IsString()
  @MaxLength(64)
  typeId?: string;

  /** Fuso horário IANA do browser (ex.: Europe/Lisbon), para os dias baterem com a grelha. Por omissão, UTC. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;
}
