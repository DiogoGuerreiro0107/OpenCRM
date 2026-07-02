import type { PipelineWithStages, Stage, StageType } from "@opencrm/shared-types";
import { api } from "./api";

export async function listPipelines() {
  const { data } = await api.get<PipelineWithStages[]>("/pipelines");
  return data;
}

export async function createPipeline(name: string) {
  const { data } = await api.post<PipelineWithStages>("/pipelines", { name });
  return data;
}

export async function updatePipeline(id: string, name: string) {
  const { data } = await api.patch<PipelineWithStages>(`/pipelines/${id}`, { name });
  return data;
}

export async function deletePipeline(id: string) {
  await api.delete(`/pipelines/${id}`);
}

export async function addStage(pipelineId: string, input: { name: string; type?: StageType }) {
  const { data } = await api.post<Stage>(`/pipelines/${pipelineId}/stages`, input);
  return data;
}

export async function updateStage(stageId: string, input: { name?: string; type?: StageType }) {
  const { data } = await api.patch<Stage>(`/stages/${stageId}`, input);
  return data;
}

export async function deleteStage(stageId: string) {
  await api.delete(`/stages/${stageId}`);
}

export async function reorderStages(pipelineId: string, stages: { id: string; order: number }[]) {
  const { data } = await api.patch<PipelineWithStages>(`/pipelines/${pipelineId}/stages/reorder`, {
    stages,
  });
  return data;
}
