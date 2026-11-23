import { ProductUnit } from "@prisma/client";
import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Catálogo de produtos (Fase 5a). Nos campos opcionais, `null` apaga. */

const MAX_MONEY = 999_999_999;

export class CreateProductDto {
  @IsString()
  @Matches(/\S/, { message: "Indica a referência" })
  @MaxLength(64)
  sku!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(32)
  barcode?: string | null;

  @IsString()
  @Matches(/\S/, { message: "Indica o nome" })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsEnum(ProductUnit)
  unit?: ProductUnit;

  /** Sem IVA; `null` = sob consulta. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "O preço tem no máximo duas casas decimais" })
  @Min(0, { message: "O preço não pode ser negativo" })
  @Max(MAX_MONEY)
  salePrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: "A taxa de IVA vai de 0 a 100" })
  @Max(100, { message: "A taxa de IVA vai de 0 a 100" })
  vatRate?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  tracksStock?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: "O stock mínimo não pode ser negativo" })
  @Max(MAX_MONEY)
  minStock?: number | null;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "Indica a referência" })
  @MaxLength(64)
  sku?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(32)
  barcode?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "Indica o nome" })
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsEnum(ProductUnit)
  unit?: ProductUnit;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: "O preço tem no máximo duas casas decimais" })
  @Min(0, { message: "O preço não pode ser negativo" })
  @Max(MAX_MONEY)
  salePrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: "A taxa de IVA vai de 0 a 100" })
  @Max(100, { message: "A taxa de IVA vai de 0 a 100" })
  vatRate?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  categoryId?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  tracksStock?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: "O stock mínimo não pode ser negativo" })
  @Max(MAX_MONEY)
  minStock?: number | null;
}

export class QueryProductsDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Por omissão, só os ativos. */
  @IsOptional()
  @IsIn(["true", "false", "all"])
  active?: "true" | "false" | "all";

  @IsOptional()
  @IsIn(["true", "false"])
  tracksStock?: "true" | "false";

  /** Produtos de um fornecedor (empresa). */
  @IsOptional()
  @IsString()
  supplierId?: string;
}

export class AddProductSupplierDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  supplierSku?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 }, { message: "O custo tem no máximo quatro casas decimais" })
  @Min(0, { message: "O custo não pode ser negativo" })
  @Max(MAX_MONEY)
  costPrice?: number | null;

  @IsOptional()
  @IsBoolean()
  preferred?: boolean;
}

export class UpdateProductSupplierDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(64)
  supplierSku?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 }, { message: "O custo tem no máximo quatro casas decimais" })
  @Min(0, { message: "O custo não pode ser negativo" })
  @Max(MAX_MONEY)
  costPrice?: number | null;

  @IsOptional()
  @IsBoolean()
  preferred?: boolean;
}

export class CreateProductCategoryDto {
  @IsString()
  @Matches(/\S/, { message: "Indica o nome" })
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateProductCategoryDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "Indica o nome" })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
