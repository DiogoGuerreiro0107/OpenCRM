import { Type } from "class-transformer";
import { CustomFieldEntityType } from "@prisma/client";
import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";

class CustomFieldValueInputDto {
  @IsString()
  customFieldId!: string;

  @IsOptional()
  value: unknown;
}

export class UpsertCustomFieldValuesDto {
  @IsEnum(CustomFieldEntityType)
  entityType!: CustomFieldEntityType;

  @IsString()
  entityId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldValueInputDto)
  values!: CustomFieldValueInputDto[];
}
