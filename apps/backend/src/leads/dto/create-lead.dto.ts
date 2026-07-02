import { LeadInterest, LeadStatus } from "@prisma/client";
import { IsDateString, IsEmail, IsEnum, IsOptional, IsString, MinLength } from "class-validator";

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
  @IsEnum(LeadInterest)
  interest?: LeadInterest;

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
}
