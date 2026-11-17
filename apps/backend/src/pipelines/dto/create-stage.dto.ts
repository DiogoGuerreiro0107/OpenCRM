import { IsIn, IsOptional, IsString, MinLength } from "class-validator";
import { STAGE_TYPES, StageType } from "../../workflows/workflow-steps";

export class CreateStageDto {
  @IsString()
  @MinLength(1)
  name!: string;

  /** Como sempre na API dos negócios: OPEN, WON ou LOST (gravado como categoria + resultado, ver workflow-steps.ts). */
  @IsOptional()
  @IsIn(STAGE_TYPES)
  type?: StageType;
}
