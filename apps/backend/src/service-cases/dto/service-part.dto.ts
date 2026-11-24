import { Type } from "class-transformer";
import { IsDateString, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";

/** Peças usadas numa assistência (Fase 4c). */

const MAX_QUANTITY = 99_999_999;

export class CreateServicePartDto {
  /** Obrigatória sem produto; com produto, por omissão o nome dele (Fase 5c). */
  @ValidateIf((o: CreateServicePartDto) => !o.productId || o.description !== undefined)
  @IsString()
  @Matches(/\S/, { message: "Descreve a peça" })
  @MaxLength(300)
  description?: string;

  /** Com produto, por omissão a referência dele. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  /** Produto do catálogo (Fase 5c): só ao adicionar; trocar é retirar e adicionar outra. */
  @IsOptional()
  @IsString()
  productId?: string;

  /** Por omissão 1; até duas casas decimais (ex.: metros de cabo). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A quantidade tem no máximo duas casas decimais" })
  @Min(0.01, { message: "A quantidade tem de ser positiva" })
  @Max(MAX_QUANTITY)
  quantity?: number;
}

export class UpdateServicePartDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "Descreve a peça" })
  @MaxLength(300)
  description?: string;

  /** `null` apaga a referência. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  reference?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A quantidade tem no máximo duas casas decimais" })
  @Min(0.01, { message: "A quantidade tem de ser positiva" })
  @Max(MAX_QUANTITY)
  quantity?: number;
}

/** Indicadores das assistências: período [from, to) e, opcionalmente, uma pessoa. */
export class ServiceIndicatorsQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /** Responsável das assistências (e técnico, no tempo). */
  @IsOptional()
  @IsString()
  assigneeId?: string;
}
