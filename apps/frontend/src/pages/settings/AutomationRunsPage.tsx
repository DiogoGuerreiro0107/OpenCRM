import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AutomationRun } from "@opencrm/shared-types";
import { listAutomationRuns, listAutomationRules } from "@/lib/automations-api";
import { LoadMore, usePagedList } from "@/lib/pagination";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const OUTCOMES: Record<AutomationRun["outcome"], { label: string; className: string }> = {
  SUCCEEDED: { label: "Correu", className: "border-green-200 bg-green-100 text-green-800" },
  SKIPPED: { label: "Ignorada", className: "" },
  FAILED: { label: "Falhou", className: "border-red-200 bg-red-100 text-red-800" },
};
const ENTITIES: Record<string, string> = { DEAL: "Negócio", WORK_ITEM: "Tarefa", LEAD: "Lead" };
const TRIGGERS: Record<string, string> = {
  CREATED: "criado",
  ENTERED_STEP: "entrou no passo",
  CLOSED: "fechado",
  FIELD_CHANGED: "campo alterado",
  IDLE_IN_STEP: "parado no passo",
  ALL_TASKS_CLOSED: "tarefas fechadas",
  TIMER_STOPPED: "cronómetro parado",
};

/**
 * Configurações > Automações > Histórico (Fase 3c): o que as regras fizeram, o que foi ignorado e porquê, e as falhas.
 * Guarda 90 dias. Uma execução desencadeada por outra automação mostra a profundidade na cadeia.
 */
export function AutomationRunsPage() {
  const [ruleId, setRuleId] = useState("");
  const [outcome, setOutcome] = useState<"" | AutomationRun["outcome"]>("");
  const { data: rules = [] } = useQuery({ queryKey: ["automation-rules"], queryFn: listAutomationRules });
  const runs = usePagedList(["automation-runs", ruleId, outcome], (cursor) =>
    listAutomationRuns({ ruleId: ruleId || undefined, outcome: outcome || undefined, cursor, limit: 50 }),
  );

  return (
    <div className="space-y-4">
      <div>
        <Link to="/configuracoes/automacoes" className="text-xs text-muted-foreground hover:underline">
          ← Automações
        </Link>
        <h1 className="text-2xl font-semibold">Histórico de automações</h1>
        <p className="text-sm text-muted-foreground">O que as regras fizeram nos últimos 90 dias, o que foi ignorado e porquê, e as falhas.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select aria-label="Regra" value={ruleId} onChange={(e) => setRuleId(e.target.value)} className="w-72">
          <option value="">Todas as regras</option>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </Select>
        <Select aria-label="Resultado" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} className="w-48">
          <option value="">Todos os resultados</option>
          {Object.entries(OUTCOMES).map(([value, o]) => (
            <option key={value} value={value}>{o.label}</option>
          ))}
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Quando</th>
              <th className="px-4 py-2 font-medium">Regra</th>
              <th className="px-4 py-2 font-medium">Registo</th>
              <th className="px-4 py-2 font-medium">Resultado</th>
              <th className="px-4 py-2 font-medium">Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {runs.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">A carregar...</td>
              </tr>
            )}
            {!runs.isLoading && runs.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Nenhuma execução.</td>
              </tr>
            )}
            {runs.items.map((run) => (
              <tr key={run.id} className="border-b border-border last:border-0 align-top">
                <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{new Date(run.createdAt).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "medium" })}</td>
                <td className="px-4 py-2">
                  {run.rule.name}
                  <span className="block text-xs text-muted-foreground">
                    {TRIGGERS[run.trigger] ?? run.trigger}
                    {run.depth > 0 ? ` · desencadeada por outra automação (nível ${run.depth})` : ""}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className="text-xs text-muted-foreground">{ENTITIES[run.entityType] ?? run.entityType}</span>
                  <span className={cn("block", !run.entityLabel && "italic text-muted-foreground")}>{run.entityLabel ?? "(apagado)"}</span>
                </td>
                <td className="px-4 py-2">
                  <Badge className={OUTCOMES[run.outcome].className}>{OUTCOMES[run.outcome].label}</Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{run.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LoadMore shown={runs.items.length} hasMore={runs.hasNextPage} loading={runs.isFetchingNextPage} onMore={() => runs.fetchNextPage()} noun={["execução", "execuções"]} />
    </div>
  );
}
