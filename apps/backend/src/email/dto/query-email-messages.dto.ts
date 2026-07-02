import { IsOptional, IsString } from "class-validator";

export class QueryEmailMessagesDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
