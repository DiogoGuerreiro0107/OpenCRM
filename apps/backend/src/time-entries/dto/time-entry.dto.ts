import { IsBoolean, IsDateString, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Registo de tempo (Fase 4b). */

export class StartTimerDto {
  @IsString()
  workItemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StopTimerDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Registo manual (esqueci-me de ligar o cronómetro). */
export class CreateTimeEntryDto {
  @IsString()
  workItemId!: string;

  @IsDateString()
  startedAt!: string;

  @IsDateString()
  endedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  billable?: boolean;
}

export class UpdateTimeEntryDto {
  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @IsOptional()
  @IsDateString()
  endedAt?: string;

  /** `null` apaga a nota. */
  @IsOptional()
  @ValidateIf((o: UpdateTimeEntryDto) => o.note !== null)
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  billable?: boolean;

  /** Obrigatório quando mudam as horas. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** Fuso do browser, para as horas do texto na timeline. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;
}

export class DeleteTimeEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;
}

export class QueryTimeEntriesDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  workItemId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class TimeSummaryQueryDto {
  @IsString()
  workItemId!: string;
}
