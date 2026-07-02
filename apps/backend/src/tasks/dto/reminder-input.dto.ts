import { IsDateString, IsOptional, IsString } from "class-validator";

export class ReminderInputDto {
  @IsDateString()
  remindAt!: string;

  @IsOptional()
  @IsString()
  message?: string;
}
