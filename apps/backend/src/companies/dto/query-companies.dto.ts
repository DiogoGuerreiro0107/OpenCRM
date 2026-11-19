import { CompanySource, CompanyStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Filtros da listagem paginada (docs/plano-paginacao-listagens.md); `limit` e `cursor` vêm de PageQueryDto. */
export class QueryCompaniesDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
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
