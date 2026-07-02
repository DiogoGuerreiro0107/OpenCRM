import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutomationActionType, AutomationRule, AutomationTriggerType } from "@opencrm/shared-types";
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

const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  STAGE_IDLE_TIME: "Tempo parado numa fase",
  TASK_COMPLETED: "Todas as tarefas concluídas",
  FIELD_CHANGED: "Campo do negócio alterado",
};

const ACTION_LABELS: Record<AutomationActionType, string> = {
  MOVE_STAGE: "Mover para outra fase/funil",
  TRIGGER_WEBHOOK: "Disparar webhook (n8n)",
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
    triggerType: "STAGE_IDLE_TIME" as AutomationTriggerType,
    idleDays: "7",
    fieldChangedField: "value",
    fieldChangedOperator: "gt",
    fieldChangedValue: "",
    actionType: "MOVE_STAGE" as AutomationActionType,
    targetPipelineId: "",
    targetStageId: "",
    webhookEvent: "",
  });

  useEffect(() => {
    if (!open) return;
    const trigger = rule?.triggerConfig ?? {};
    const action = rule?.actionConfig ?? {};
    setForm({
      name: rule?.name ?? "",
      active: rule?.active ?? true,
      pipelineId: rule?.pipelineId ?? "",
      stageId: rule?.stageId ?? "",
      triggerType: rule?.triggerType ?? "STAGE_IDLE_TIME",
      idleDays: trigger.days != null ? String(trigger.days) : "7",
      fieldChangedField: (trigger.field as string) ?? "value",
      fieldChangedOperator: (trigger.operator as string) ?? "gt",
      fieldChangedValue: trigger.value != null ? String(trigger.value) : "",
      actionType: rule?.actionType ?? "MOVE_STAGE",
      targetPipelineId: "",
      targetStageId: (action.targetStageId as string) ?? "",
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
  const needsScopeStage = form.triggerType === "STAGE_IDLE_TIME" || form.triggerType === "TASK_COMPLETED";

  const saveMutation = useMutation({
    mutationFn: () => {
      const triggerConfig: Record<string, unknown> =
        form.triggerType === "STAGE_IDLE_TIME"
          ? { days: Number(form.idleDays) || 1 }
          : form.triggerType === "FIELD_CHANGED"
            ? {
                field: form.fieldChangedField,
                operator: form.fieldChangedOperator,
                value: Number(form.fieldChangedValue) || 0,
              }
            : {};

      const actionConfig: Record<string, unknown> =
        form.actionType === "MOVE_STAGE" ? { targetStageId: form.targetStageId } : { event: form.webhookEvent };

      const payload = {
        name: form.name,
        active: form.active,
        pipelineId: form.pipelineId || undefined,
        stageId: needsScopeStage ? form.stageId || undefined : undefined,
        triggerType: form.triggerType,
        triggerConfig,
        actionType: form.actionType,
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

  const canSubmit =
    form.name.trim() &&
    (!needsScopeStage || form.stageId) &&
    (form.actionType !== "MOVE_STAGE" || form.targetStageId) &&
    (form.actionType !== "TRIGGER_WEBHOOK" || form.webhookEvent.trim());

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

        {form.triggerType === "STAGE_IDLE_TIME" && (
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

        {form.actionType === "MOVE_STAGE" && (
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

        {form.actionType === "TRIGGER_WEBHOOK" && (
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
          <p className="text-sm text-red-600">Não foi possível guardar a regra. Tenta novamente.</p>
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
