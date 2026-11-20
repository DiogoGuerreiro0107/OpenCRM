import { useQuery } from "@tanstack/react-query";
import { getAutomationCatalog } from "@/lib/automations-api";
import { listPipelines } from "@/lib/pipelines-api";
import { listWorkItemTypes } from "@/lib/work-item-types-api";
import { listUsers } from "@/lib/tasks-api";
import { useModuleEnabled } from "@/lib/useModules";
import type { AutomationLookups } from "./automation-text";

/**
 * Tudo o que o editor e a lista das automações precisam (Fase 3c): o catálogo do servidor, os funis (com as fases), os
 * tipos de tarefa (com os passos) e os utilizadores, mais os nomes por id para as frases.
 */
export function useAutomationLookups(enabled = true) {
  const dealsOn = useModuleEnabled("deals");
  const catalog = useQuery({ queryKey: ["automation-rules", "catalog"], queryFn: getAutomationCatalog, enabled });
  const pipelines = useQuery({ queryKey: ["pipelines"], queryFn: listPipelines, enabled: enabled && dealsOn });
  const types = useQuery({ queryKey: ["work-item-types", "all"], queryFn: () => listWorkItemTypes(), enabled });
  const users = useQuery({ queryKey: ["users"], queryFn: listUsers, enabled, staleTime: 60_000 });

  const steps = new Map<string, string>();
  const workflows = new Map<string, string>();
  for (const p of pipelines.data ?? []) {
    workflows.set(p.id, p.name);
    for (const s of p.stages) steps.set(s.id, s.name);
  }
  for (const t of types.data ?? []) {
    if (t.workflowId) workflows.set(t.workflowId, t.name);
    for (const s of t.steps) steps.set(s.id, `${t.name}: ${s.name}`);
  }
  const lookups: AutomationLookups = {
    catalog: catalog.data,
    steps,
    workflows,
    users: new Map((users.data ?? []).map((u) => [u.id, u.name])),
    types: new Map((types.data ?? []).map((t) => [t.id, t.name])),
  };
  return {
    lookups,
    catalog: catalog.data,
    pipelines: pipelines.data ?? [],
    types: types.data ?? [],
    users: users.data ?? [],
    isLoading: catalog.isLoading,
  };
}
