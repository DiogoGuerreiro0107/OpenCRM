import { IsIn } from "class-validator";
import { CUSTOM_FIELD_ENTITY_TYPES, CustomFieldEntityType } from "../entity-registry";

export class QueryCustomFieldsDto {
  @IsIn(CUSTOM_FIELD_ENTITY_TYPES, { message: `entityType tem de ser um destes: ${CUSTOM_FIELD_ENTITY_TYPES.join(", ")}` })
  entityType!: CustomFieldEntityType;
}
