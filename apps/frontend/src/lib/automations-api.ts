import type { AutomationActionType, AutomationRule, AutomationTriggerType } from "@opencrm/shared-types";
import { api } from "./api";

export interface AutomationRuleInput {
  name: string;
  active?: boolean;
  pipelineId?: string;
  stageId?: string;
  triggerType: AutomationTriggerType;
  triggerConfig: Record<string, unknown>;
  actionType: AutomationActionType;
  actionConfig: Record<string, unknown>;
}

export async function listAutomationRules() {
  const { data } = await api.get<AutomationRule[]>("/automation-rules");
  return data;
}

export async function createAutomationRule(input: AutomationRuleInput) {
  const { data } = await api.post<AutomationRule>("/automation-rules", input);
  return data;
}

export async function updateAutomationRule(id: string, input: Partial<AutomationRuleInput>) {
  const { data } = await api.patch<AutomationRule>(`/automation-rules/${id}`, input);
  return data;
}

export async function deleteAutomationRule(id: string) {
  await api.delete(`/automation-rules/${id}`);
}
