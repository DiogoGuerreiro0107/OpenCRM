import { LeadStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class QueryLeadsDto {
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  responsavelId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
