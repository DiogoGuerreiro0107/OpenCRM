import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class SaveZadarmaAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  apiKey?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  apiSecret?: string;

  @IsOptional()
  @IsString()
  callerExtension?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
