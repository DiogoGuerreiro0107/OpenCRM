import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AutomationRule } from "@opencrm/shared-types";
import { listAutomationRules } from "@/lib/automations-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AutomationRuleDialog } from "./AutomationRuleDialog";

const TRIGGER_SUMMARY: Record<string, (rule: AutomationRule) => string> = {
  STAGE_IDLE_TIME: (rule) => `Parado ${rule.triggerConfig.days ?? "?"} dias em "${rule.stage?.name ?? "?"}"`,
  TASK_COMPLETED: (rule) => `Tarefas concluídas em "${rule.stage?.name ?? "?"}"`,
  FIELD_CHANGED: (rule) =>
    `Campo "${rule.triggerConfig.field ?? "?"}" ${rule.triggerConfig.operator ?? "?"} ${rule.triggerConfig.value ?? "?"}`,
};

const ACTION_SUMMARY: Record<string, (rule: AutomationRule) => string> = {
  MOVE_STAGE: () => "Move para outra fase",
  TRIGGER_WEBHOOK: (rule) => `Dispara webhook "${rule.actionConfig.event ?? "?"}"`,
};

export function AutomationsSettingsPage() {
  const [dialogState, setDialogState] = useState<{ rule: AutomationRule | null } | null>(null);

  const { data: rules, isLoading } = useQuery({
    queryKey: ["automation-rules"],
    queryFn: listAutomationRules,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Automações</h1>
        <Button onClick={() => setDialogState({ rule: null })}>Nova regra</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Regras que movem negócios automaticamente entre fases/funis com base em eventos, ou disparam um webhook para
        o n8n.
      </p>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Gatilho</th>
              <th className="px-4 py-2 font-medium">Ação</th>
              <th className="px-4 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  A carregar...
                </td>
              </tr>
            )}
            {!isLoading && rules?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhuma regra de automação criada.
                </td>
              </tr>
            )}
            {rules?.map((rule) => (
              <tr
                key={rule.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                onClick={() => setDialogState({ rule })}
              >
                <td className="px-4 py-2 font-medium">{rule.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{TRIGGER_SUMMARY[rule.triggerType]?.(rule)}</td>
                <td className="px-4 py-2 text-muted-foreground">{ACTION_SUMMARY[rule.actionType]?.(rule)}</td>
                <td className="px-4 py-2">
                  <Badge className={rule.active ? "bg-green-100 text-green-800 border-green-200" : ""}>
                    {rule.active ? "Ativa" : "Inativa"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialogState && (
        <AutomationRuleDialog open onClose={() => setDialogState(null)} rule={dialogState.rule} />
      )}
    </div>
  );
}
