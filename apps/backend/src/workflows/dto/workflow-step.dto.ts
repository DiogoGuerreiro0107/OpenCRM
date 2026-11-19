import { Type } from "class-transformer";
import { WorkflowOutcome, WorkflowStepCategory } from "@prisma/client";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";

export class CreateWorkflowStepDto {
  @IsString()
  @Matches(/\S/, { message: "O nome do passo não pode ficar vazio" })
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsEnum(WorkflowStepCategory)
  category?: WorkflowStepCategory;

  /** Só em passos concluídos e só nos tipos de registo que o usam (negócios). */
  @IsOptional()
  @IsEnum(WorkflowOutcome)
  outcome?: WorkflowOutcome;
}

export class UpdateWorkflowStepDto {
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "O nome do passo não pode ficar vazio" })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(WorkflowStepCategory)
  category?: WorkflowStepCategory;

  /** `null` tira o resultado. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(WorkflowOutcome)
  outcome?: WorkflowOutcome | null;
}

class StepOrderDto {
  @IsString()
  id!: string;

  @IsInt()
  @Min(0)
  order!: number;
}

export class ReorderWorkflowStepsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => StepOrderDto)
  steps!: StepOrderDto[];
}
