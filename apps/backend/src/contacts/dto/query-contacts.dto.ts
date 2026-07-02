import { IsOptional, IsString } from "class-validator";

export class QueryContactsDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
