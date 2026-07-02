import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Lead, LeadStatus } from "@opencrm/shared-types";
import { listLeads } from "@/lib/leads-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LeadDialog } from "./LeadDialog";

const STATUS_TABS: { value: LeadStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "NOVO", label: "Novo" },
  { value: "CONTACTADO", label: "Contactado" },
  { value: "SEM_RESPOSTA", label: "Sem resposta" },
  { value: "CONVERTIDO", label: "Convertido" },
  { value: "PERDIDO", label: "Perdido" },
];

const STATUS_BADGE_CLASS: Record<LeadStatus, string> = {
  NOVO: "bg-blue-100 text-blue-800 border-blue-200",
  CONTACTADO: "",
  SEM_RESPOSTA: "bg-amber-100 text-amber-800 border-amber-200",
  CONVERTIDO: "bg-green-100 text-green-800 border-green-200",
  PERDIDO: "bg-red-100 text-red-800 border-red-200",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  NOVO: "Novo",
  CONTACTADO: "Contactado",
  SEM_RESPOSTA: "Sem resposta",
  CONVERTIDO: "Convertido",
  PERDIDO: "Perdido",
};

export function LeadsListPage() {
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [dialogState, setDialogState] = useState<{ lead: Lead | null } | null>(null);

  const { data: leads, isLoading } = useQuery({
    queryKey: ["leads", statusFilter, search],
    queryFn: () =>
      listLeads({
        status: statusFilter === "ALL" ? undefined : statusFilter,
        search: search || undefined,
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <Button onClick={() => setDialogState({ lead: null })}>Novo lead</Button>
      </div>

      <Input
        placeholder="Pesquisar por nome, empresa, email, telefone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />

      <div className="flex gap-2 border-b border-border">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab.value === statusFilter
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nome</th>
              <th className="px-4 py-2 font-medium">Empresa</th>
              <th className="px-4 py-2 font-medium">Origem</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 font-medium">Responsável</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  A carregar...
                </td>
              </tr>
            )}
            {!isLoading && leads?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum lead encontrado.
                </td>
              </tr>
            )}
            {leads?.map((lead) => (
              <tr
                key={lead.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                onClick={() => setDialogState({ lead })}
              >
                <td className="px-4 py-2 font-medium">{lead.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{lead.companyName ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{lead.source ?? "—"}</td>
                <td className="px-4 py-2">
                  <Badge className={STATUS_BADGE_CLASS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{lead.responsavel?.name ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialogState && (
        <LeadDialog open onClose={() => setDialogState(null)} lead={dialogState.lead} />
      )}
    </div>
  );
}
