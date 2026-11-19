import { ArrayMaxSize, IsArray, IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength } from "class-validator";

/**
 * Regra de automação (Fase 3a). Os valores de `entityType`, `trigger`, `action` e as configurações são validados pelo
 * serviço contra os registos (src/automations/registry/), que sabem o que cada tipo de registo aceita.
 */
export class CreateAutomationRuleDto {
  @IsString()
  @Matches(/\S/, { message: "O nome não pode estar vazio" })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsString()
  @MaxLength(40)
  entityType!: string;

  @IsOptional()
  @IsString()
  workflowId?: string | null;

  @IsOptional()
  @IsString()
  stepId?: string | null;

  @IsString()
  @MaxLength(40)
  trigger!: string;

  @IsOptional()
  @IsObject()
  triggerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  conditions?: unknown[];

  @IsString()
  @MaxLength(40)
  action!: string;

  @IsOptional()
  @IsObject()
  actionConfig?: Record<string, unknown>;
}

export class QueryAutomationRunsDto {
  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @Matches(/^(SUCCEEDED|SKIPPED|FAILED)$/)
  outcome?: "SUCCEEDED" | "SKIPPED" | "FAILED";
}
