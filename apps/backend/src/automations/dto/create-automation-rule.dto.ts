import { AutomationActionType, AutomationTriggerType } from "@prisma/client";
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MinLength } from "class-validator";

export class CreateAutomationRuleDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  pipelineId?: string;

  @IsOptional()
  @IsString()
  stageId?: string;

  @IsEnum(AutomationTriggerType)
  triggerType!: AutomationTriggerType;

  @IsObject()
  triggerConfig!: Record<string, unknown>;

  @IsEnum(AutomationActionType)
  actionType!: AutomationActionType;

  @IsObject()
  actionConfig!: Record<string, unknown>;
}
