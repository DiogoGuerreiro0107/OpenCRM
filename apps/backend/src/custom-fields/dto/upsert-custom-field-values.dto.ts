import { Type } from "class-transformer";
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from "class-validator";
import { CUSTOM_FIELD_ENTITY_TYPES, CustomFieldEntityType } from "../entity-registry";

class CustomFieldValueInputDto {
  @IsString()
  customFieldId!: string;

  @IsOptional()
  value: unknown;
}

export class UpsertCustomFieldValuesDto {
  @IsIn(CUSTOM_FIELD_ENTITY_TYPES, { message: `entityType tem de ser um destes: ${CUSTOM_FIELD_ENTITY_TYPES.join(", ")}` })
  entityType!: CustomFieldEntityType;

  @IsString()
  entityId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldValueInputDto)
  values!: CustomFieldValueInputDto[];
}
