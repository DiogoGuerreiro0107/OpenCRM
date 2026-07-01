import { ActivityType } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";

export class CreateActivityLogDto {
  @IsEnum(ActivityType)
  type!: ActivityType;

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
