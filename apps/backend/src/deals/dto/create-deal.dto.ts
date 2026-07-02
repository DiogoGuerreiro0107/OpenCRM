import { BusinessArea } from "@prisma/client";
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class CreateDealDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  pipelineId!: string;

  @IsString()
  stageId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  @IsOptional()
  @IsEnum(BusinessArea)
  type?: BusinessArea;

  @IsOptional()
  @IsNumber()
  estimatedMargin?: number;

  @IsOptional()
  @IsString()
  lossReason?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
