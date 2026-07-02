import { CustomFieldEntityType } from "@prisma/client";
import { IsEnum } from "class-validator";

export class QueryCustomFieldsDto {
  @IsEnum(CustomFieldEntityType)
  entityType!: CustomFieldEntityType;
}
