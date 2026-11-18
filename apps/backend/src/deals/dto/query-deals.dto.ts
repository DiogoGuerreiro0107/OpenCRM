import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Filtros comuns ao quadro (cartões e resumo por fase). */
export class DealFiltersDto {
  @IsString()
  @MinLength(1)
  pipelineId!: string;

  /** Contém (título do negócio, empresa ou contacto), sem acentos. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** Cartões de uma coluna do quadro, paginados pela ordem da coluna (docs/plano-paginacao-listagens.md). */
export class QueryDealsDto extends PageQueryDto {
  @IsString()
  @MinLength(1)
  pipelineId!: string;

  @IsOptional()
  @IsString()
  stageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
