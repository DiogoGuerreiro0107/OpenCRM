import { PurchaseOrderStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Compras a fornecedor (Fase 6c). Nos campos opcionais, `null` apaga. */

const MAX_COST = 99_999_999;
const MAX_QUANTITY = 99_999_999;

export class CreatePurchaseOrderDto {
  /** Empresa marcada como fornecedor. */
  @IsString()
  supplierId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  supplierReference?: string;

  /** Data prevista de entrega (AAAA-MM-DD). */
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "A data prevista é um dia (AAAA-MM-DD)" })
  expectedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class UpdatePurchaseOrderDto {
  /** O fornecedor só se muda em rascunho. */
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  supplierReference?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "A data prevista é um dia (AAAA-MM-DD)" })
  expectedAt?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class QueryPurchaseOrdersDto extends PageQueryDto {
  /** Número («CF-0007», «7»), referência do fornecedor, nome ou NIF do fornecedor. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(PurchaseOrderStatus)
  status?: PurchaseOrderStatus;

  @IsOptional()
  @IsString()
  supplierId?: string;

  /** Compras com este produto nas linhas. */
  @IsOptional()
  @IsString()
  productId?: string;
}

export class CreatePurchaseLineDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A quantidade tem no máximo duas casas decimais" })
  @Min(0.01, { message: "A quantidade tem de ser positiva" })
  @Max(MAX_QUANTITY)
  quantity!: number;

  /** Sem IVA. Por omissão, o custo deste fornecedor no catálogo (só quem vê custos o pode indicar). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 }, { message: "O custo tem no máximo quatro casas decimais" })
  @Min(0)
  @Max(MAX_COST)
  unitCost?: number;
}

export class UpdatePurchaseLineDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A quantidade tem no máximo duas casas decimais" })
  @Min(0.01, { message: "A quantidade tem de ser positiva" })
  @Max(MAX_QUANTITY)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 }, { message: "O custo tem no máximo quatro casas decimais" })
  @Min(0)
  @Max(MAX_COST)
  unitCost?: number;
}

export class ReceiveLineDto {
  @IsString()
  lineId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A quantidade tem no máximo duas casas decimais" })
  @Min(0.01, { message: "A quantidade recebida tem de ser positiva" })
  @Max(MAX_QUANTITY)
  quantity!: number;
}

export class ReceivePurchaseDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Indica o que foi recebido" })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines!: ReceiveLineDto[];

  /** Ex.: o n.º da guia do fornecedor. Vai para a timeline e para os movimentos de stock. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ClosePurchaseDto {
  @IsString()
  @Matches(/\S/, { message: "Indica o motivo" })
  @MaxLength(500)
  reason!: string;
}

export class GeneratePurchasesDto {
  @IsArray()
  @ArrayMinSize(1, { message: "Escolhe pelo menos um produto" })
  @ArrayMaxSize(200)
  @IsString({ each: true })
  productIds!: string[];
}
