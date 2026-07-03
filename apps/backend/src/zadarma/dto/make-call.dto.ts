import { IsOptional, IsString, MinLength } from "class-validator";

export class MakeCallDto {
  @IsString()
  @MinLength(1)
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  dealId?: string;
}
