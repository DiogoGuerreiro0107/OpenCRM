import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { V1ListQueryDto } from "./v1-list-query.dto";

/** API pública de produtos e encomendas (Fase 6e). snake_case, como todo o contrato da v1. */

const MAX_MONEY = 999_999_999;
const MAX_QUANTITY = 99_999_999;
export const MAX_API_ORDER_LINES = 200;

export class V1ListProductsQueryDto extends V1ListQueryDto {
  /** Referência exata (sem distinguir maiúsculas). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string;
}

export class V1ListOrdersQueryDto extends V1ListQueryDto {
  /** O id externo que ESTA chave deu à encomenda ao criá-la. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  external_id?: string;
}

/** Cliente da encomenda: encontrado pelo NIF (empresa) e pelo email (contacto), ou criado. */
export class V1OrderCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tax_id?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_name?: string;

  /** A pessoa (contacto). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}

/** Linha: por `sku` (produto do catálogo) ou livre (`description` + `unit_price` + `vat_rate`, ex.: portes). */
export class V1OrderLineDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "sku vazio" })
  @MaxLength(64)
  sku?: string;

  /** Obrigatória nas linhas livres; nas de produto, por omissão o nome do produto. */
  @ValidateIf((o: V1OrderLineDto) => !o.sku || o.description !== undefined)
  @IsString({ message: "description é obrigatória numa linha sem sku" })
  @Matches(/\S/, { message: "description é obrigatória numa linha sem sku" })
  @MaxLength(300)
  description?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "quantity tem no máximo duas casas decimais" })
  @Min(0.01, { message: "quantity tem de ser positiva" })
  @Max(MAX_QUANTITY)
  quantity!: number;

  /** Preço unitário SEM IVA. Obrigatório nas linhas livres; nas de produto, por omissão o preço do catálogo. */
  @ValidateIf((o: V1OrderLineDto) => !o.sku || o.unit_price !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "unit_price é obrigatório numa linha sem sku (no máximo duas casas decimais)" })
  @Min(0)
  @Max(MAX_MONEY)
  unit_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discount_pct?: number;

  /** Taxa de IVA (%). Obrigatória nas linhas livres; nas de produto, por omissão a do produto. */
  @ValidateIf((o: V1OrderLineDto) => !o.sku || o.vat_rate !== undefined)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "vat_rate é obrigatória numa linha sem sku" })
  @Min(0)
  @Max(100)
  vat_rate?: number;
}

export class V1CreateOrderDto {
  @IsDefined({ message: "customer é obrigatório" })
  @ValidateNested()
  @Type(() => V1OrderCustomerDto)
  customer!: V1OrderCustomerDto;

  @IsArray()
  @ArrayMinSize(1, { message: "lines tem de ter pelo menos uma linha" })
  @ArrayMaxSize(MAX_API_ORDER_LINES)
  @ValidateNested({ each: true })
  @Type(() => V1OrderLineDto)
  lines!: V1OrderLineDto[];

  /** Por omissão, o `external_id`. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customer_reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  delivery_address?: string;

  /** Notas internas da encomenda (ex.: o comentário do cliente na loja). */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  /** `true`: nasce confirmada e reserva stock. `false` (por omissão): fica em rascunho para a equipa rever. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;

  /**
   * Número da encomenda na loja. Se a MESMA chave voltar a enviá-lo, nada é criado e a resposta é 409 com o id da
   * encomenda que já existe.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  external_id?: string;
}
