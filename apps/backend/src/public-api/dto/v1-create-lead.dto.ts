import { BusinessArea } from "@prisma/client";
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

/**
 * Corpo de `POST /api/v1/leads`. Mais pequeno do que o da interface de propósito: uma integração (p. ex. o
 * formulário do site) não escolhe o estado nem o responsável.
 */
export class V1CreateLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /** Origem do lead (texto livre). Por omissão: «API: <nome da chave>». */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsOptional()
  @IsEnum(BusinessArea)
  interest?: BusinessArea;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
