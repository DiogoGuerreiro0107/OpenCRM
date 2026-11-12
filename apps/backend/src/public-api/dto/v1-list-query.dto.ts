import { Type } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

/** Parâmetros de listagem da API pública (snake_case, como todo o contrato da v1). */
export class V1ListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  /** Só o que mudou desde esta data (ISO 8601): sincronização incremental. */
  @IsOptional()
  @IsDateString()
  updated_since?: string;
}
