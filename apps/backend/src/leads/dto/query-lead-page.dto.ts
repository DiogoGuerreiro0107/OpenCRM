import { LeadKind, LeadStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/** Filtros da listagem paginada (Fase 1b). As contagens por separador aceitam os mesmos, menos o estado e o cursor. */
export class QueryLeadPageDto {
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsEnum(LeadKind)
  kind?: LeadKind;

  @IsOptional()
  @IsString()
  responsavelId?: string;

  /** Contém (nome, empresa, NIF, email ou telefone), sem distinguir maiúsculas. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
