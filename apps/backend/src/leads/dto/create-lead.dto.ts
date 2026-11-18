import { BusinessArea, LeadKind, LeadStatus } from "@prisma/client";
import { IsDateString, IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateLeadDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsEnum(BusinessArea)
  interest?: BusinessArea;

  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  responsavelId?: string;

  @IsOptional()
  @IsDateString()
  nextActionAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Empresa ou pessoa. Sem valor: conforme o modo do módulo (ver lead-mode.ts). */
  @IsOptional()
  @IsEnum(LeadKind)
  kind?: LeadKind;

  /** NIF (leads de empresa). */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  taxId?: string;

  /** Cargo (leads de pessoa). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  jobTitle?: string;

  /** Empresa que já existe no CRM (opcional). */
  @IsOptional()
  @IsString()
  companyId?: string;

  /** Contacto que já existe no CRM (opcional). Se não for dada empresa, usa-se a do contacto. */
  @IsOptional()
  @IsString()
  contactId?: string;
}
