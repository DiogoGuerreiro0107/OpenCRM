import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import type { AutomationActionType, AutomationCatalogEntity, AutomationCatalogField, AutomationCondition, AutomationRule, AutomationTriggerType } from "@opencrm/shared-types";
import { createAutomationRule, deleteAutomationRule, updateAutomationRule, type AutomationRuleInput } from "@/lib/automations-api";
import { errorMessage } from "@/lib/errors";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { UserPicker } from "@/components/pickers";
import { describeRule } from "./automation-text";
import { useAutomationLookups } from "./useAutomationLookups";

/**
 * Editor genérico de regras de automação (Fase 3c, docs/plano-fase-3-automacoes.md). Lê o catálogo do servidor: os
 * tipos de registo, gatilhos, ações, campos e operadores que aparecem vêm dos registos do backend, por isso um módulo
 * novo aparece aqui sem mudar este ficheiro. A validação a sério é a do servidor; os erros dele aparecem como vêm.
 */

type Draft = Omit<AutomationRuleInput, "triggerConfig" | "actionConfig"> & {
  triggerConfig: Record<string, unknown>;
  actionConfig: Record<string, unknown>;
};

const EMPTY: Draft = {
  name: "",
  active: true,
  entityType: "DEAL",
  workflowId: null,
  stepId: null,
  trigger: "FIELD_CHANGED",
  triggerConfig: {},
  conditions: [],
  action: "WEBHOOK",
  actionConfig: {},
};

const DUE_UNITS = [
  { value: "hours", label: "horas" },
  { value: "days", label: "dias" },
  { value: "business_days", label: "dias úteis" },
];
const PRIORITIES = [
  { value: "", label: "Normal (por omissão)" },
  { value: "BAIXA", label: "Baixa" },
  { value: "ALTA", label: "Alta" },
  { value: "URGENTE", label: "Urgente" },
];
const UNARY = ["empty", "not_empty"];

/** Configuração inicial de cada ação: o que o editor mostra escolhido tem de ir no pedido. */
const defaultActionConfig = (action: string): Record<string, unknown> => (action === "CREATE_WORK_ITEM" ? { assignee: { mode: "OWNER" } } : {});

interface AutomationRuleDialogProps {
  open: boolean;
  onClose: () => void;
  rule?: AutomationRule | null;
}

export function AutomationRuleDialog({ open, onClose, rule }: AutomationRuleDialogProps) {
  const queryClient = useQueryClient();
  const { catalog, lookups, pipelines, types, isLoading } = useAutomationLookups(open);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  /** Funil escolhido para o passo de destino de «mover» (nos negócios o destino pode ser de outro funil). */
  const [targetWorkflowId, setTargetWorkflowId] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(
      rule
        ? {
            name: rule.name,
            active: rule.active,
            entityType: rule.entityType,
            workflowId: rule.workflowId,
            stepId: rule.stepId,
            trigger: rule.trigger,
            triggerConfig: rule.triggerConfig,
            conditions: rule.conditions,
            action: rule.action,
            actionConfig: rule.actionConfig,
          }
        : EMPTY,
    );
    setTargetWorkflowId("");
  }, [open, rule]);

  const entity: AutomationCatalogEntity | undefined = catalog?.entities.find((e) => e.id === draft.entityType);
  const trigger = entity?.triggers.find((t) => t.id === draft.trigger);
  const fields = entity?.fields ?? [];

  // Âmbito: fluxos do tipo de registo (negócios: funis; tarefas: tipos de tarefa com passos).
  const workflowOptions =
    entity?.workflowEntity === "DEAL"
      ? pipelines.map((p) => ({ id: p.id, name: p.name, steps: [...p.stages].sort((a, b) => a.order - b.order).map((s) => ({ id: s.id, name: s.name })) }))
      : entity?.workflowEntity === "WORK_ITEM"
        ? types.filter((t) => t.workflowId).map((t) => ({ id: t.workflowId!, name: t.name, steps: t.steps.map((s) => ({ id: s.id, name: s.name })) }))
        : [];
  const scopeSteps = workflowOptions.find((w) => w.id === draft.workflowId)?.steps ?? [];
  const ownerOfTarget = workflowOptions.find((w) => w.steps.some((s) => s.id === draft.actionConfig.targetStepId))?.id ?? "";
  const targetWorkflow = draft.entityType === "WORK_ITEM" ? (draft.workflowId ?? "") : targetWorkflowId || ownerOfTarget;
  const targetSteps = workflowOptions.find((w) => w.id === targetWorkflow)?.steps ?? [];

  // O passo de uma regra antiga pode vir sem o fluxo: o fluxo deduz-se do passo.
  useEffect(() => {
    if (!draft.stepId || draft.workflowId) return;
    const owner = workflowOptions.find((w) => w.steps.some((s) => s.id === draft.stepId));
    if (owner) setDraft((d) => ({ ...d, workflowId: owner.id }));
  }, [draft.stepId, draft.workflowId, workflowOptions]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setTriggerConfig = (patch: Record<string, unknown>) => setDraft((d) => ({ ...d, triggerConfig: { ...d.triggerConfig, ...patch } }));
  const setActionConfig = (patch: Record<string, unknown>) => setDraft((d) => ({ ...d, actionConfig: { ...d.actionConfig, ...patch } }));
  const setCondition = (index: number, patch: Partial<AutomationCondition>) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));

  /** Mudar o tipo de registo recomeça o resto (gatilhos, campos e ações são outros). */
  function changeEntity(entityType: string) {
    const next = catalog?.entities.find((e) => e.id === entityType);
    set({
      entityType,
      workflowId: null,
      stepId: null,
      trigger: next?.triggers[0]?.id ?? "CREATED",
      triggerConfig: {},
      conditions: [],
      action: next?.actions[0]?.id ?? "WEBHOOK",
      actionConfig: defaultActionConfig(next?.actions[0]?.id ?? "WEBHOOK"),
    });
    setTargetWorkflowId("");
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["automation-rules"] });
  const save = useMutation({
    mutationFn: () => {
      const payload: AutomationRuleInput = { ...draft, name: draft.name.trim(), workflowId: draft.workflowId || null, stepId: draft.stepId || null };
      return rule ? updateAutomationRule(rule.id, payload) : createAutomationRule(payload);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteAutomationRule(rule!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  if (isLoading || !catalog) {
    return (
      <Dialog open={open} onClose={onClose} className="max-w-2xl">
        <p className="text-sm text-muted-foreground">A carregar...</p>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{rule ? "Editar regra" : "Nova regra de automação"}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-5 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {rule?.systemKey && <p className="rounded-md bg-muted/50 p-2 text-sm text-muted-foreground">Regra do sistema: pode ser alterada ou desativada, mas não apagada.</p>}

        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="rule-name">Nome *</Label>
            <Input id="rule-name" value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} required />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
            Ativa
          </label>
        </div>

        {/* ------------------------------------------------------------------------------------------------ Quando */}
        <fieldset className="space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Quando</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="rule-entity" className="text-xs">Tipo de registo</Label>
              <Select id="rule-entity" value={draft.entityType} onChange={(e) => changeEntity(e.target.value)}>
                {catalog.entities.map((e) => (
                  <option key={e.id} value={e.id}>{e.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rule-trigger" className="text-xs">Acontece</Label>
              <Select id="rule-trigger" value={draft.trigger} onChange={(e) => set({ trigger: e.target.value as AutomationTriggerType, triggerConfig: {} })}>
                {entity?.triggers.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </Select>
            </div>
          </div>

          {entity?.workflowEntity && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rule-workflow" className="text-xs">{entity.workflowEntity === "DEAL" ? "Funil" : "Tipo de tarefa (com passos)"}</Label>
                <Select id="rule-workflow" value={draft.workflowId ?? ""} onChange={(e) => set({ workflowId: e.target.value || null, stepId: null })}>
                  <option value="">{entity.workflowEntity === "DEAL" ? "Qualquer funil" : "Qualquer tipo"}</option>
                  {workflowOptions.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="rule-step" className="text-xs">{entity.workflowEntity === "DEAL" ? "Fase" : "Passo"}{trigger?.step === "required" ? " *" : ""}</Label>
                <Select id="rule-step" value={draft.stepId ?? ""} onChange={(e) => set({ stepId: e.target.value || null })} disabled={!draft.workflowId}>
                  <option value="">{trigger?.step === "required" ? "Escolher..." : "Qualquer"}</option>
                  {scopeSteps.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {draft.trigger === "IDLE_IN_STEP" && (
            <div className="w-40 space-y-1">
              <Label htmlFor="rule-days" className="text-xs">Dias parado</Label>
              <Input id="rule-days" type="number" min={1} value={String(draft.triggerConfig.days ?? "")} onChange={(e) => setTriggerConfig({ days: e.target.value ? Number(e.target.value) : undefined })} />
            </div>
          )}
          {draft.trigger === "FIELD_CHANGED" && (
            <div className="w-64 space-y-1">
              <Label htmlFor="rule-field" className="text-xs">Campo que muda</Label>
              <Select id="rule-field" value={String(draft.triggerConfig.field ?? "")} onChange={(e) => setTriggerConfig({ field: e.target.value || undefined })}>
                <option value="">Escolher...</option>
                {fields.filter((f) => entity?.changeTracked.includes(f.name)).map((f) => (
                  <option key={f.name} value={f.name}>{f.label}</option>
                ))}
              </Select>
            </div>
          )}
        </fieldset>

        {/* ------------------------------------------------------------------------------------------------- E se */}
        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold">E se (todas)</legend>
          {draft.conditions.length === 0 && <p className="text-xs text-muted-foreground">Sem condições: corre sempre que o gatilho acontece.</p>}
          {draft.conditions.map((c, i) => {
            const field = fields.find((f) => f.name === c.field);
            const operators = field ? catalog.operatorsByKind[field.kind] : [];
            return (
              <div key={i} className="flex items-center gap-2">
                <Select aria-label={`Campo da condição ${i + 1}`} value={c.field} className="w-48" onChange={(e) => setCondition(i, { field: e.target.value, operator: "eq", value: undefined })}>
                  {fields.map((f) => (
                    <option key={f.name} value={f.name}>{f.label}</option>
                  ))}
                </Select>
                <Select aria-label={`Operador da condição ${i + 1}`} value={c.operator} className="w-40" onChange={(e) => setCondition(i, { operator: e.target.value as AutomationCondition["operator"] })}>
                  {operators.map((op) => (
                    <option key={op} value={op}>{catalog.operators[op]}</option>
                  ))}
                </Select>
                {!UNARY.includes(c.operator) && field && <ConditionValue field={field} value={c.value} onChange={(value) => setCondition(i, { value })} index={i} />}
                <Button type="button" variant="outline" size="sm" aria-label={`Tirar a condição ${i + 1}`} onClick={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          {fields.length > 0 && draft.conditions.length < 10 && (
            <Button type="button" variant="outline" size="sm" onClick={() => set({ conditions: [...draft.conditions, { field: fields[0].name, operator: "eq" }] })}>
              + Condição
            </Button>
          )}
        </fieldset>

        {/* ------------------------------------------------------------------------------------------------ Então */}
        <fieldset className="space-y-3 rounded-md border border-border p-3">
          <legend className="px-1 text-sm font-semibold">Então</legend>
          <div className="w-64 space-y-1">
            <Label htmlFor="rule-action" className="text-xs">Ação</Label>
            <Select id="rule-action" value={draft.action} onChange={(e) => set({ action: e.target.value as AutomationActionType, actionConfig: defaultActionConfig(e.target.value) })}>
              {entity?.actions.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </Select>
          </div>

          {draft.action === "MOVE_TO_STEP" && (
            <div className="grid grid-cols-2 gap-3">
              {draft.entityType === "DEAL" ? (
                <div className="space-y-1">
                  <Label htmlFor="rule-target-workflow" className="text-xs">Funil de destino</Label>
                  <Select id="rule-target-workflow" value={targetWorkflow} onChange={(e) => { setTargetWorkflowId(e.target.value); setActionConfig({ targetStepId: undefined }); }}>
                    <option value="">Escolher...</option>
                    {workflowOptions.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </Select>
                </div>
              ) : (
                <p className="self-end text-xs text-muted-foreground">{draft.workflowId ? "Passos do tipo de tarefa da regra." : "Escolhe primeiro, em «Quando», o tipo de tarefa (com passos)."}</p>
              )}
              <div className="space-y-1">
                <Label htmlFor="rule-target-step" className="text-xs">Passo de destino *</Label>
                <Select id="rule-target-step" value={String(draft.actionConfig.targetStepId ?? "")} onChange={(e) => setActionConfig({ targetStepId: e.target.value || undefined })}>
                  <option value="">Escolher...</option>
                  {targetSteps.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {draft.action === "WEBHOOK" && (
            <div className="w-80 space-y-1">
              <Label htmlFor="rule-event" className="text-xs">Nome do evento</Label>
              <Input id="rule-event" value={String(draft.actionConfig.event ?? "")} placeholder="automation.triggered" onChange={(e) => setActionConfig({ event: e.target.value })} />
            </div>
          )}

          {draft.action === "ASSIGN" && (
            <div className="w-72 space-y-1">
              <Label htmlFor="rule-assign" className="text-xs">Atribuir a</Label>
              <UserPicker id="rule-assign" value={String(draft.actionConfig.userId ?? "")} onChange={(id) => setActionConfig({ userId: id || undefined })} emptyLabel="Escolher..." />
            </div>
          )}

          {draft.action === "CREATE_WORK_ITEM" && entity && (
            <CreateTaskConfig entity={entity} config={draft.actionConfig} onChange={setActionConfig} types={types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }))} />
          )}
        </fieldset>

        <p className="rounded-md bg-primary/5 p-3 text-sm" aria-label="Resumo da regra">
          {describeRule({ ...draft, workflowId: draft.workflowId ?? null, stepId: draft.stepId ?? null }, lookups)}
        </p>

        {(save.isError || remove.isError) && <p className="text-sm text-red-600">{errorMessage(save.error ?? remove.error, "Não foi possível guardar a regra.")}</p>}

        <div className="flex justify-between pt-1">
          {rule && !rule.systemKey ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (confirm("Eliminar esta regra de automação?")) remove.mutate();
              }}
            >
              Eliminar
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending || !draft.name.trim()}>
              {save.isPending ? "A guardar..." : "Guardar"}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/** Valor de uma condição: lista quando há opções ou utilizadores; número nos campos numéricos; texto nos outros. */
function ConditionValue({ field, value, onChange, index }: { field: AutomationCatalogField; value: AutomationCondition["value"]; onChange: (v: AutomationCondition["value"]) => void; index: number }) {
  const label = `Valor da condição ${index + 1}`;
  if (field.kind === "user") {
    return <UserPicker aria-label={label} value={String(value ?? "")} onChange={(id) => onChange(id || null)} emptyLabel="Escolher..." className="w-52" />;
  }
  if (field.kind === "option") {
    return (
      <Select aria-label={label} value={String(value ?? "")} className="w-52" onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Escolher...</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    );
  }
  if (field.kind === "number") {
    return <Input aria-label={label} type="number" value={value === null || value === undefined ? "" : String(value)} className="w-36" onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
  }
  return <Input aria-label={label} value={String(value ?? "")} className="w-52" onChange={(e) => onChange(e.target.value)} />;
}

/** Modelo da tarefa a criar: tipo, título com variáveis, responsável, prazo e prioridade. */
function CreateTaskConfig({ entity, config, onChange, types }: { entity: AutomationCatalogEntity; config: Record<string, unknown>; onChange: (patch: Record<string, unknown>) => void; types: Array<{ id: string; name: string }> }) {
  const assignee = (config.assignee ?? { mode: "OWNER" }) as { mode: string; userId?: string };
  const due = config.due as { amount: number; unit: string } | undefined;
  const title = String(config.title ?? "");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[12rem_1fr] gap-3">
        <div className="space-y-1">
          <Label htmlFor="task-type" className="text-xs">Tipo de tarefa *</Label>
          <Select id="task-type" value={String(config.typeId ?? "")} onChange={(e) => onChange({ typeId: e.target.value || undefined })}>
            <option value="">Escolher...</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="task-title" className="text-xs">Título *</Label>
          <Input id="task-title" value={title} maxLength={200} onChange={(e) => onChange({ title: e.target.value })} />
          <div className="flex flex-wrap gap-1">
            {Object.entries(entity.variables).map(([name, description]) => (
              <button key={name} type="button" title={description} className="rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted" onClick={() => onChange({ title: `${title}{${name}}` })}>
                {`{${name}}`}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="task-assignee" className="text-xs">Responsável</Label>
          <Select id="task-assignee" value={assignee.mode} onChange={(e) => onChange({ assignee: { mode: e.target.value } })}>
            <option value="OWNER">O responsável do registo (senão, quem fez)</option>
            <option value="ACTOR">Quem fez a ação (senão, o do registo)</option>
            <option value="USER">Uma pessoa escolhida</option>
          </Select>
        </div>
        {assignee.mode === "USER" && (
          <div className="space-y-1">
            <Label htmlFor="task-user" className="text-xs">Pessoa</Label>
            <UserPicker id="task-user" value={assignee.userId ?? ""} onChange={(id) => onChange({ assignee: { mode: "USER", userId: id || undefined } })} emptyLabel="Escolher..." />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={!!due} onChange={(e) => onChange({ due: e.target.checked ? { amount: 1, unit: "days" } : undefined })} />
          Com prazo
        </label>
        {due && (
          <>
            <div className="w-24 space-y-1">
              <Label htmlFor="task-due" className="text-xs">Daqui a</Label>
              <Input id="task-due" type="number" min={0} value={String(due.amount)} onChange={(e) => onChange({ due: { ...due, amount: Number(e.target.value) } })} />
            </div>
            <div className="w-36 space-y-1">
              <Label htmlFor="task-unit" className="sr-only">Unidade</Label>
              <Select id="task-unit" value={due.unit} onChange={(e) => onChange({ due: { ...due, unit: e.target.value } })}>
                {DUE_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </Select>
            </div>
          </>
        )}
        <div className="w-48 space-y-1">
          <Label htmlFor="task-priority" className="text-xs">Prioridade</Label>
          <Select id="task-priority" value={String(config.priority ?? "")} onChange={(e) => onChange({ priority: e.target.value || undefined })}>
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}
