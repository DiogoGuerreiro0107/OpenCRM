import { Type } from "class-transformer";
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from "class-validator";
import { TaskStatus } from "@prisma/client";
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

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

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
