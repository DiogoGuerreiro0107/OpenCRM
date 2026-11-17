import { Prisma, WorkflowOutcome, WorkflowStepCategory } from "@prisma/client";

/**
 * Regras ÚNICAS sobre passos de fluxo (Fase 0c, docs/plano-fase-0-fundacoes.md). Todo o código que precisa de saber
 * se algo está «aberto», «ganho» ou «perdido» usa estas funções, em vez de comparar valores soltos.
 */

export interface StepState {
  category: WorkflowStepCategory;
  outcome: WorkflowOutcome | null;
}

/** Categorias em que o item ainda está em curso (não fechado). */
export const OPEN_CATEGORIES: WorkflowStepCategory[] = ["OPEN", "IN_PROGRESS"];

/** Filtro Prisma para passos abertos (usar em `where: { stage: OPEN_STEP_WHERE }`). */
export const OPEN_STEP_WHERE: Prisma.WorkflowStepWhereInput = { category: { in: OPEN_CATEGORIES } };

export const isOpenStep = (step: StepState) => OPEN_CATEGORIES.includes(step.category);

/** Os três estados que os NEGÓCIOS conhecem (e que a API /pipelines continua a expor como `type`). */
export type StageType = "OPEN" | "WON" | "LOST";
export const STAGE_TYPES: StageType[] = ["OPEN", "WON", "LOST"];

/**
 * Estado de negócio de um passo. Coerente com `isOpenStep`: aberto → OPEN; fechado → WON se o resultado for WON,
 * senão LOST (um passo CANCELLED ou concluído sem resultado conta como não ganho).
 */
export function stageTypeOf(step: StepState): StageType {
  if (isOpenStep(step)) return "OPEN";
  return step.outcome === "WON" ? "WON" : "LOST";
}

/** Categoria e resultado a gravar para um `type` vindo da API dos negócios. */
export function stepStateFor(type: StageType): StepState {
  if (type === "OPEN") return { category: "OPEN", outcome: null };
  return { category: "DONE", outcome: type };
}
