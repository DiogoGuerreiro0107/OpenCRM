import { ServiceWarranty, WorkItemPriority } from "@prisma/client";
import { IsDateString, IsEnum, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateIf } from "class-validator";
import { PageQueryDto } from "../../common/pagination";

/** Nova assistência (Fase 4a): a tarefa (cliente, responsável, prazo) e os dados próprios, numa só operação. */
export class CreateServiceCaseDto {
  /** Título da tarefa; sem ele, o início do problema reportado. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsString()
  @Matches(/\S/, { message: "Descreve o problema reportado" })
  @MaxLength(5000)
  reportedProblem!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  serialNumber?: string;

  @IsOptional()
  @IsEnum(ServiceWarranty)
  underWarranty?: ServiceWarranty;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(WorkItemPriority)
  priority?: WorkItemPriority;
}

/** Dados próprios de uma assistência; a tarefa (passo, estado, responsável, prazo) edita-se em /tasks/:id. `null` limpa. */
export class UpdateServiceCaseDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  brand?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  model?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  serialNumber?: string | null;

  @IsOptional()
  @IsEnum(ServiceWarranty)
  underWarranty?: ServiceWarranty;

  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: "O problema reportado não pode ficar vazio" })
  @MaxLength(5000)
  reportedProblem?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5000)
  diagnosis?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5000)
  resolution?: string | null;
}

/** Lista paginada de assistências. */
export class QueryServiceCasesDto extends PageQueryDto {
  /** Número (AS-0012 ou 12), título, cliente, marca, modelo, série ou problema. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** «open» = em aberto (pendente ou em progresso); «closed» = concluídas ou canceladas. */
  @IsOptional()
  @IsIn(["open", "closed"])
  state?: "open" | "closed";

  @IsOptional()
  @IsString()
  stepId?: string;

  @IsOptional()
  @IsString()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  contactId?: string;
}
