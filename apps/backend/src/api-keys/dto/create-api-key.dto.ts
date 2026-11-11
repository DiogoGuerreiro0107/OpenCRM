import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** Âmbitos (ver public-api/scopes.ts). Um âmbito desconhecido é recusado no serviço. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  scopes!: string[];

  /** Sem data = não expira. Tem de ser futura (validado no serviço). */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  /** Pedidos por minuto (1 a 1000; por omissão 120). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  rateLimitPerMinute?: number;
}
