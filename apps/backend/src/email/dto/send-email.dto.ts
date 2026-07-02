import { ArrayMinSize, IsArray, IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class SendEmailDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  to!: string[];

  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  text!: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
