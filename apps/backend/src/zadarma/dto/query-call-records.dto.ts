import { IsOptional, IsString } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Chamadas paginadas (mais recente primeiro). */
export class QueryCallRecordsDto extends PageQueryDto {
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
