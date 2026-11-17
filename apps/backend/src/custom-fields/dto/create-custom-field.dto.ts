import { CustomFieldType } from "@prisma/client";
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, MinLength } from "class-validator";
import { CUSTOM_FIELD_ENTITY_TYPES, CustomFieldEntityType } from "../entity-registry";

export class CreateCustomFieldDto {
  @IsIn(CUSTOM_FIELD_ENTITY_TYPES, { message: `entityType tem de ser um destes: ${CUSTOM_FIELD_ENTITY_TYPES.join(", ")}` })
  entityType!: CustomFieldEntityType;

  @IsOptional()
  @IsString()
  sectionName?: string;

  @IsOptional()
  @IsString()
  fieldName?: string;

  @IsString()
  @MinLength(1)
  fieldLabel!: string;

  @IsEnum(CustomFieldType)
  fieldType!: CustomFieldType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  isSearchable?: boolean;

  @IsOptional()
  @IsBoolean()
  isFilterable?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
