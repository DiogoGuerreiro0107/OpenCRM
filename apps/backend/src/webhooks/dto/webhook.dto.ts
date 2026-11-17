import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateWebhookDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** http(s), sem credenciais embutidas (validado no serviço). */
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  url!: string;

  /** Tipos de evento, ou "*" para todos (validado no serviço). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  events!: string[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class QueryDeliveriesDto {
  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @IsOptional()
  @IsIn(["PENDING", "DELIVERED", "FAILED"])
  status?: "PENDING" | "DELIVERED" | "FAILED";

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
