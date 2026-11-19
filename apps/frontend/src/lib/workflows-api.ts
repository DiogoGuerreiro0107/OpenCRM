import type { WorkflowStepCategory, WorkflowView } from "@opencrm/shared-types";
import { api } from "./api";

/** Rotas genéricas de fluxos (Fase 2b): passos de qualquer tipo de registo com fluxos. Configurar é do Administrador. */
export async function getWorkflow(id: string) {
  const { data } = await api.get<WorkflowView>(`/workflows/${id}`);
  return data;
}

export async function addWorkflowStep(workflowId: string, input: { name: string; category: WorkflowStepCategory }) {
  const { data } = await api.post(`/workflows/${workflowId}/steps`, input);
  return data;
}

export async function updateWorkflowStep(stepId: string, input: { name?: string; category?: WorkflowStepCategory }) {
  const { data } = await api.patch(`/workflow-steps/${stepId}`, input);
  return data;
}

/** `moveTo`: passo do mesmo fluxo para onde vão os itens deste passo antes de ele ser apagado. */
export async function deleteWorkflowStep(stepId: string, moveTo?: string) {
  await api.delete(`/workflow-steps/${stepId}`, { params: moveTo ? { moveTo } : undefined });
}

export async function reorderWorkflowSteps(workflowId: string, stepIds: string[]) {
  const { data } = await api.patch<WorkflowView>(`/workflows/${workflowId}/steps/order`, {
    steps: stepIds.map((id, order) => ({ id, order })),
  });
  return data;
}

/** Nomes das categorias de passo, como aparecem nas tarefas. */
export const STEP_CATEGORY_LABELS: Record<WorkflowStepCategory, string> = {
  OPEN: "Por fazer",
  IN_PROGRESS: "Em curso",
  DONE: "Concluída",
  CANCELLED: "Cancelada",
};
