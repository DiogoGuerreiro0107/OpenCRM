import { StockMovementType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Tipos que se lançam à mão (o consumo em assistência é lançado pelo sistema, na 5c). */
export const MANUAL_MOVEMENT_TYPES = ["INITIAL", "PURCHASE_IN", "SALE_OUT", "RETURN", "ADJUSTMENT"] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

const MAX_QTY = 99_999_999;

/** Movimento de stock manual (Fase 5b). Entradas/saídas/devoluções/inicial: `quantity` positiva. Acerto: `countedQuantity`. */
export class CreateStockMovementDto {
  @IsString()
  productId!: string;

  @IsIn(MANUAL_MOVEMENT_TYPES)
  type!: ManualMovementType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A quantidade tem no máximo duas casas decimais" })
  @Min(0.01, { message: "A quantidade tem de ser positiva" })
  @Max(MAX_QTY)
  quantity?: number;

  /** Acerto de contagem: a quantidade que se contou (o servidor lança a diferença). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A contagem tem no máximo duas casas decimais" })
  @Min(0, { message: "A contagem não pode ser negativa" })
  @Max(MAX_QTY)
  countedQuantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class QueryStockMovementsDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsIn(Object.values(StockMovementType))
  type?: StockMovementType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
