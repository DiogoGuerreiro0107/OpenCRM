import { IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Mensagens paginadas (mais recente primeiro), da caixa ou de um registo. */
export class QueryEmailMessagesDto extends PageQueryDto {
  /** Contém (assunto, remetente ou destinatários), sem acentos. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;
}
