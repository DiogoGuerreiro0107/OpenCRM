import { PartialType, OmitType } from "@nestjs/mapped-types";
import { CreateCustomFieldDto } from "./create-custom-field.dto";

export class UpdateCustomFieldDto extends PartialType(OmitType(CreateCustomFieldDto, ["entityType"] as const)) {}
