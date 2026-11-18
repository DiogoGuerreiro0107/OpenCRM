import { BusinessArea, LeadKind } from "@prisma/client";
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

  /** Empresa ou pessoa. Sem valor: conforme o modo do módulo (com nome de empresa → empresa). */
  @IsOptional()
  @IsEnum(LeadKind)
  kind?: LeadKind;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company_name?: string;

  /** NIF (leads de empresa). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  tax_id?: string;

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

  /**
   * Id deste lead no sistema de origem (loja, formulário...). Se a MESMA chave de API voltar a enviar o mesmo
   * `external_id`, nada é criado e a resposta é 409 com o id do lead que já existe (ver docs/api-publica.md).
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  external_id?: string;
}
