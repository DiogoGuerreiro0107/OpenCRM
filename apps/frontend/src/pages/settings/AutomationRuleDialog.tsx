import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutomationActionType, AutomationCondition, AutomationRule, AutomationTriggerType } from "@opencrm/shared-types";
import { errorMessage } from "@/lib/errors";
import {
  createAutomationRule,
  deleteAutomationRule,
  updateAutomationRule,
} from "@/lib/automations-api";
import { listPipelines } from "@/lib/pipelines-api";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

const TRIGGER_LABELS: Partial<Record<AutomationTriggerType, string>> = {
  IDLE_IN_STEP: "Tempo parado numa fase",
  ALL_TASKS_CLOSED: "Todas as tarefas concluídas",
  FIELD_CHANGED: "Campo do negócio alterado",
};

const ACTION_LABELS: Partial<Record<AutomationActionType, string>> = {
  MOVE_TO_STEP: "Mover para outra fase/funil",
  WEBHOOK: "Disparar webhook (n8n)",
};

const FIELD_LABELS: Record<string, string> = {
  value: "Valor",
  probability: "Probabilidade",
  estimatedMargin: "Margem estimada",
};

const OPERATOR_LABELS: Record<string, string> = {
  gt: "maior que",
  gte: "maior ou igual a",
  lt: "menor que",
  lte: "menor ou igual a",
  eq: "igual a",
};

interface AutomationRuleDialogProps {
  open: boolean;
  onClose: () => void;
  rule?: AutomationRule | null;
}

export function AutomationRuleDialog({ open, onClose, rule }: AutomationRuleDialogProps) {
  const queryClient = useQueryClient();
  const { data: pipelines } = useQuery({ queryKey: ["pipelines"], queryFn: listPipelines, enabled: open });

  const [form, setForm] = useState({
    name: "",
    active: true,
    pipelineId: "",
    stageId: "",
    triggerType: "IDLE_IN_STEP" as AutomationTriggerType,
    idleDays: "7",
    fieldChangedField: "value",
    fieldChangedOperator: "gt",
    fieldChangedValue: "",
    actionType: "MOVE_TO_STEP" as AutomationActionType,
    targetPipelineId: "",
    targetStageId: "",
    webhookEvent: "",
  });

  useEffect(() => {
    if (!open) return;
    const trigger = rule?.triggerConfig ?? {};
    const action = rule?.actionConfig ?? {};
    // Este editor mostra a primeira condição (o editor genérico chega no 3c).
    const condition: Partial<AutomationCondition> = rule?.conditions[0] ?? {};
    setForm({
      name: rule?.name ?? "",
      active: rule?.active ?? true,
      pipelineId: rule?.workflowId ?? "",
      stageId: rule?.stepId ?? "",
      triggerType: rule?.trigger ?? "IDLE_IN_STEP",
      idleDays: trigger.days != null ? String(trigger.days) : "7",
      fieldChangedField: (trigger.field as string) ?? "value",
      fieldChangedOperator: condition.operator ?? "gt",
      fieldChangedValue: condition.value != null ? String(condition.value) : "",
      actionType: rule?.action ?? "MOVE_TO_STEP",
      targetPipelineId: "",
      targetStageId: (action.targetStepId as string) ?? "",
      webhookEvent: (action.event as string) ?? "",
    });
  }, [open, rule]);

  // Resolve targetPipelineId from targetStageId once pipelines are loaded (rule edit case)
  useEffect(() => {
    if (!pipelines || !form.targetStageId || form.targetPipelineId) return;
    const owner = pipelines.find((p) => p.stages.some((s) => s.id === form.targetStageId));
    if (owner) setForm((prev) => ({ ...prev, targetPipelineId: owner.id }));
  }, [pipelines, form.targetStageId, form.targetPipelineId]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["automation-rules"] });
  }

  const scopeStages = pipelines?.find((p) => p.id === form.pipelineId)?.stages ?? [];
  const targetStages = pipelines?.find((p) => p.id === form.targetPipelineId)?.stages ?? [];
  const needsScopeStage = form.triggerType === "IDLE_IN_STEP" || form.triggerType === "ALL_TASKS_CLOSED";

  const saveMutation = useMutation({
    mutationFn: () => {
      const triggerConfig: Record<string, unknown> =
        form.triggerType === "IDLE_IN_STEP"
          ? { days: Number(form.idleDays) || 1 }
          : form.triggerType === "FIELD_CHANGED"
            ? { field: form.fieldChangedField }
            : {};
      // «Campo alterado»: o campo que muda é também o da condição (como sempre neste editor).
      const conditions: AutomationCondition[] =
        form.triggerType === "FIELD_CHANGED"
          ? [{ field: form.fieldChangedField, operator: form.fieldChangedOperator as AutomationCondition["operator"], value: Number(form.fieldChangedValue) || 0 }]
          : [];

      const actionConfig: Record<string, unknown> =
        form.actionType === "MOVE_TO_STEP" ? { targetStepId: form.targetStageId } : { event: form.webhookEvent };

      const payload = {
        name: form.name,
        active: form.active,
        entityType: "DEAL",
        workflowId: form.pipelineId || null,
        stepId: needsScopeStage ? form.stageId || null : null,
        trigger: form.triggerType,
        triggerConfig,
        conditions,
        action: form.actionType,
        actionConfig,
      };
      return rule ? updateAutomationRule(rule.id, payload) : createAutomationRule(payload);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAutomationRule(rule!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
    };
  }

  // Este editor só desenha regras de negócios com os gatilhos e ações de sempre. As outras (de tarefas e leads, criar
  // tarefa, atribuir...) configuram-se pela API até ao editor genérico (3c): aqui só se ativam ou desativam, para não as
  // estragar ao gravar.
  const supported = !rule || (rule.entityType === "DEAL" && rule.trigger in TRIGGER_LABELS && rule.action in ACTION_LABELS);
  const toggleMutation = useMutation({
    mutationFn: () => updateAutomationRule(rule!.id, { name: form.name, active: form.active }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const canSubmit =
    form.name.trim() &&
    (!needsScopeStage || form.stageId) &&
    (form.actionType !== "MOVE_TO_STEP" || form.targetStageId) &&
    (form.actionType !== "WEBHOOK" || form.webhookEvent.trim());

  if (rule && !supported) {
    return (
      <Dialog open={open} onClose={onClose} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule.name}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            toggleMutation.mutate();
          }}
        >
          <p className="text-sm text-muted-foreground">
            {rule.systemKey ? "Regra do sistema: pode ser desativada, mas não apagada. " : ""}
            O editor desta regra chega com o editor genérico de automações; por agora só se ativa ou desativa aqui.
          </p>
          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input id="name" value={form.name} onChange={handleChange("name")} required />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={handleChange("active")} />
            Ativa
          </label>
          {toggleMutation.isError && <p className="text-sm text-red-600">{errorMessage(toggleMutation.error, "Não foi possível guardar.")}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={toggleMutation.isPending || !form.name.trim()}>
              Guardar
            </Button>
          </div>
        </form>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{rule ? "Editar regra" : "Nova regra de automação"}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) saveMutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="name">Nome *</Label>
          <Input id="name" value={form.name} onChange={handleChange("name")} required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="triggerType">Quando...</Label>
          <Select id="triggerType" value={form.triggerType} onChange={handleChange("triggerType")}>
            {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="pipelineId">Funil</Label>
            <Select
              id="pipelineId"
              value={form.pipelineId}
              onChange={(e) => setForm((prev) => ({ ...prev, pipelineId: e.target.value, stageId: "" }))}
            >
              <option value="">Qualquer funil</option>
              {pipelines?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          {needsScopeStage && (
            <div className="space-y-2">
              <Label htmlFor="stageId">Fase *</Label>
              <Select id="stageId" value={form.stageId} onChange={handleChange("stageId")} required>
                <option value="">Seleciona a fase</option>
                {scopeStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {form.triggerType === "IDLE_IN_STEP" && (
          <div className="space-y-2">
            <Label htmlFor="idleDays">Dias parado na fase</Label>
            <Input
              id="idleDays"
              type="number"
              min="1"
              value={form.idleDays}
              onChange={handleChange("idleDays")}
            />
          </div>
        )}

        {form.triggerType === "FIELD_CHANGED" && (
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-2">
              <Label htmlFor="fieldChangedField" className="text-xs">
                Campo
              </Label>
              <Select id="fieldChangedField" value={form.fieldChangedField} onChange={handleChange("fieldChangedField")}>
                {Object.entries(FIELD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fieldChangedOperator" className="text-xs">
                Condição
              </Label>
              <Select
                id="fieldChangedOperator"
                value={form.fieldChangedOperator}
                onChange={handleChange("fieldChangedOperator")}
              >
                {Object.entries(OPERATOR_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fieldChangedValue" className="text-xs">
                Valor
              </Label>
              <Input
                id="fieldChangedValue"
                type="number"
                value={form.fieldChangedValue}
                onChange={handleChange("fieldChangedValue")}
              />
            </div>
          </div>
        )}

        <div className="space-y-2 border-t border-border pt-4">
          <Label htmlFor="actionType">Então...</Label>
          <Select id="actionType" value={form.actionType} onChange={handleChange("actionType")}>
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {form.actionType === "MOVE_TO_STEP" && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="targetPipelineId">Funil de destino</Label>
              <Select
                id="targetPipelineId"
                value={form.targetPipelineId}
                onChange={(e) => setForm((prev) => ({ ...prev, targetPipelineId: e.target.value, targetStageId: "" }))}
              >
                <option value="">Seleciona o funil</option>
                {pipelines?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="targetStageId">Fase de destino *</Label>
              <Select id="targetStageId" value={form.targetStageId} onChange={handleChange("targetStageId")} required>
                <option value="">Seleciona a fase</option>
                {targetStages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {form.actionType === "WEBHOOK" && (
          <div className="space-y-2">
            <Label htmlFor="webhookEvent">Nome do evento *</Label>
            <Input
              id="webhookEvent"
              value={form.webhookEvent}
              onChange={handleChange("webhookEvent")}
              placeholder="ex: automation.follow_up"
              required
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={handleChange("active")} />
          Ativa
        </label>

        {saveMutation.isError && (
          <p className="text-sm text-red-600">{errorMessage(saveMutation.error, "Não foi possível guardar a regra. Tenta novamente.")}</p>
        )}

        <div className="flex justify-between pt-2">
          {rule ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (confirm("Eliminar esta regra de automação?")) deleteMutation.mutate();
              }}
            >
              Eliminar
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={saveMutation.isPending || !canSubmit}>
            {saveMutation.isPending ? "A guardar..." : "Guardar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
