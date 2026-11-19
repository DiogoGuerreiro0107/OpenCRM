import { PartialType } from "@nestjs/mapped-types";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { WORK_ITEM_COLORS, WORK_ITEM_ICONS } from "../system-types";

export class CreateWorkItemTypeDto {
  @IsString()
  @Matches(/\S/, { message: "O nome não pode estar vazio" })
  @MaxLength(60)
  name!: string;

  @IsIn(WORK_ITEM_ICONS)
  icon!: string;

  @IsIn(WORK_ITEM_COLORS)
  color!: string;
}

export class UpdateWorkItemTypeDto extends PartialType(CreateWorkItemTypeDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Item próprio no menu principal (Fase 2c). */
  @IsOptional()
  @IsBoolean()
  showInMenu?: boolean;
}

export class QueryWorkItemTypesDto {
  /** `true`: só os ativos (os formulários de criação). */
  @IsOptional()
  @IsIn(["true", "false"])
  active?: string;
}

export class ReorderWorkItemTypesDto {
  /** Todos os ids, pela nova ordem. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids!: string[];
}
