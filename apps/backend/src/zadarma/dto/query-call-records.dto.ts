import { IsOptional, IsString } from "class-validator";

export class QueryCallRecordsDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
