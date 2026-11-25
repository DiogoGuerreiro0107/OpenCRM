import { SalesOrderStatus } from "@prisma/client";
import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Encomendas de cliente (Fase 6a). Nos campos opcionais, `null` apaga. */

const MAX_MONEY = 999_999_999;
const MAX_QUANTITY = 99_999_999;

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

export class ShipOrderDto {
  /** Enviar mesmo com linhas à espera de stock (o stock fica negativo). */
  @IsOptional()
  @IsBoolean()
  allowShortage?: boolean;
}
