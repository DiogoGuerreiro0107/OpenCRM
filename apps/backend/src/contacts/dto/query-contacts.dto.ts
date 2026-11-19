import { IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Filtros da listagem paginada (docs/plano-paginacao-listagens.md); `limit` e `cursor` vêm de PageQueryDto. */
export class QueryContactsDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
