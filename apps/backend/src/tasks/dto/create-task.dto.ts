import { Type } from "class-transformer";
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { WorkItemPriority, WorkItemStatus } from "@prisma/client";
import { ReminderInputDto } from "./reminder-input.dto";

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  /** Horário marcado (Fase 2d), além do prazo. `null` limpa (ao editar). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  scheduledStart?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  scheduledEnd?: string | null;

  @IsOptional()
  @IsEnum(WorkItemStatus)
  status?: WorkItemStatus;

  /** Tipo de tarefa (id = código, p. ex. "VISITA"). Sem ele, «Tarefa». */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  typeId?: string;

  /** Passo (só em tipos com passos; decide o estado). Sem ele, o primeiro passo da categoria do estado. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  stepId?: string;

  @IsOptional()
  @IsEnum(WorkItemPriority)
  priority?: WorkItemPriority;

  @IsOptional()
  @IsString()
  result?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  dealId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderInputDto)
  reminders?: ReminderInputDto[];
}
