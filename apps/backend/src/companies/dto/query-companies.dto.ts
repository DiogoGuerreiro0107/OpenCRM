import { CompanySource, CompanyStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class QueryCompaniesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CompanyStatus)
  status?: CompanyStatus;

  @IsOptional()
  @IsEnum(CompanySource)
  source?: CompanySource;

  @IsOptional()
  @IsString()
  ownerId?: string;
}
