import { SalesOrderStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Encomendas de cliente (Fase 6a). Nos campos opcionais, `null` apaga. */

const MAX_MONEY = 999_999_999;
const MAX_QUANTITY = 99_999_999;
const MAX_WEIGHT = 9_999_999;

export class CreateOrderDto {
  /** Empresa e/ou contacto: pelo menos um (validado no serviço e por CHECK). */
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class UpdateOrderDto {
  /** O cliente só se muda em rascunho. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  companyId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  contactId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  assigneeId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  customerReference?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  deliveryAddress?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class QueryOrdersDto extends PageQueryDto {
  /** Número («EN-0007», «7»), referência do cliente, nome, NIF ou email do cliente. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsEnum(SalesOrderStatus)
  status?: SalesOrderStatus;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  /** «A aguardar stock» (Fase 6b): confirmadas com alguma linha à espera. */
  @IsOptional()
  @IsIn(["true"])
  waiting?: "true";

  /** «Pronta a preparar» (Fase 6c): confirmadas sem linhas à espera de stock. */
  @IsOptional()
  @IsIn(["true"])
  ready?: "true";

  /** «Parcialmente enviada» (Fase 6d): confirmadas com alguma coisa já enviada. */
  @IsOptional()
  @IsIn(["true"])
  partiallyShipped?: "true";

  /** Encomendas com este produto nas linhas. */
  @IsOptional()
  @IsString()
  productId?: string;
}

export class CreateOrderLineDto {
  /** Produto do catálogo: copia a referência, o nome, o preço e o IVA (o que vier no pedido prevalece). */
  @IsOptional()
  @IsString()
  productId?: string;

  /** Obrigatória sem produto. */
  @ValidateIf((o: CreateOrderLineDto) => !o.productId || o.description !== undefined)
  @IsString()
  @Matches(/\S/, { message: "Descreve a linha" })
  @MaxLength(300)
  description?: string;

  /** Com produto, por omissão a referência dele; `null` ou vazio = sem referência. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  sku?: string | null;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A quantidade tem no máximo duas casas decimais" })
  @Min(0.01, { message: "A quantidade tem de ser positiva" })
  @Max(MAX_QUANTITY)
  quantity!: number;

  /** Sem IVA. Obrigatório sem produto, ou se o produto não tiver preço. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "O preço tem no máximo duas casas decimais" })
  @Min(0)
  @Max(MAX_MONEY)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPct?: number;

  /** Obrigatória sem produto. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  vatRate?: number;
}

export class UpdateOrderLineDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "Descreve a linha" })
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  sku?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A quantidade tem no máximo duas casas decimais" })
  @Min(0.01, { message: "A quantidade tem de ser positiva" })
  @Max(MAX_QUANTITY)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "O preço tem no máximo duas casas decimais" })
  @Min(0)
  @Max(MAX_MONEY)
  unitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  vatRate?: number;
}

export class CancelOrderDto {
  @IsString()
  @Matches(/\S/, { message: "Indica o motivo do cancelamento" })
  @MaxLength(500)
  reason!: string;
}

/** Uma linha de um envio parcial (Fase 6d). */
export class ShipLineDto {
  @IsString()
  lineId!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "A quantidade tem no máximo duas casas decimais" })
  @Min(0.01, { message: "A quantidade a enviar tem de ser positiva" })
  @Max(MAX_QUANTITY)
  quantity!: number;
}

/** Dados do transporte de uma expedição (Fase 6d). Na correção, `null` apaga. */
export class ShipmentDetailsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  carrierId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(100)
  trackingCode?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt({ message: "Os volumes são um número inteiro" })
  @Min(1, { message: "Pelo menos 1 volume" })
  @Max(10_000)
  packages?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "O peso tem no máximo duas casas decimais" })
  @Min(0)
  @Max(MAX_WEIGHT)
  weightKg?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "O custo tem no máximo duas casas decimais" })
  @Min(0)
  @Max(MAX_MONEY)
  cost?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class ShipOrderDto extends ShipmentDetailsDto {
  /** Enviar mesmo sem o stock reservado para o que se envia (o stock fica negativo). */
  @IsOptional()
  @IsBoolean()
  allowShortage?: boolean;

  /** Envio parcial (Fase 6d): o que sai de cada linha. Sem isto, sai tudo o que falta enviar. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: "Indica o que vai neste envio" })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ShipLineDto)
  lines?: ShipLineDto[];
}

export class UpdateShipmentDto extends ShipmentDetailsDto {}

/** «Dar por enviada sem o resto» (Fase 6d). */
export class FinishOrderDto {
  @IsString()
  @Matches(/\S/, { message: "Indica porque não vai o resto" })
  @MaxLength(500)
  reason!: string;
}

export class CreateCarrierDto {
  @IsString()
  @Matches(/\S/, { message: "Indica o nome" })
  @MaxLength(80)
  name!: string;

  /** Link de seguimento com `{codigo}` (ex.: https://transportadora.pt/seguir?n={codigo}). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  trackingUrlTemplate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCarrierDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "Indica o nome" })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  trackingUrlTemplate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
