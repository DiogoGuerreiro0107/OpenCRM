import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AutomationRule } from "@opencrm/shared-types";
import { listAutomationRules } from "@/lib/automations-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AutomationRuleDialog } from "./AutomationRuleDialog";
import { describeRule } from "./automation-text";
import { useAutomationLookups } from "./useAutomationLookups";

/**
 * Configurações > Automações (Fase 3c): cada regra resumida pela frase «Quando… então…», o editor genérico e o caminho
 * para o histórico de execuções.
 */
export function AutomationsSettingsPage() {
  const [dialogState, setDialogState] = useState<{ rule: AutomationRule | null } | null>(null);
  const { lookups } = useAutomationLookups();
  const { data: rules, isLoading } = useQuery({ queryKey: ["automation-rules"], queryFn: listAutomationRules });
  const entityLabel = (type: string) => lookups.catalog?.entities.find((e) => e.id === type)?.label ?? type;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Automações</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/configuracoes/automacoes/historico">Histórico</Link>
          </Button>
          <Button onClick={() => setDialogState({ rule: null })}>Nova regra</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Regras «quando… então…» sobre negócios, tarefas e leads: mover, criar tarefas, atribuir ou enviar um webhook para o n8n.
      </p>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Registo</th>
              <th className="px-4 py-2 font-medium">Regra</th>
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
              <tr key={rule.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30" onClick={() => setDialogState({ rule })}>
                <td className="px-4 py-2 font-medium">{rule.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{entityLabel(rule.entityType)}</td>
                <td className="px-4 py-2 text-muted-foreground">{describeRule(rule, lookups)}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge className={rule.active ? "border-green-200 bg-green-100 text-green-800" : ""}>{rule.active ? "Ativa" : "Inativa"}</Badge>
                    {rule.systemKey && <Badge>Sistema</Badge>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialogState && <AutomationRuleDialog open onClose={() => setDialogState(null)} rule={dialogState.rule} />}
    </div>
  );
}
