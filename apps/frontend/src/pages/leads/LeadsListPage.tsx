import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Building2, User } from "lucide-react";
import type { Lead, LeadKind, LeadStatus } from "@opencrm/shared-types";
import { getLeadCounts, getLeadSettings, listLeadPage, type LeadFilters } from "@/lib/leads-api";
import { listUsers } from "@/lib/tasks-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useCanWrite } from "@/lib/useCanWrite";
import { LeadDialog } from "./LeadDialog";
import { leadContactLabel, leadTitle, STATUS_LABELS } from "./lead-labels";

const STATUS_TABS: { value: LeadStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "NOVO", label: STATUS_LABELS.NOVO },
  { value: "CONTACTADO", label: STATUS_LABELS.CONTACTADO },
  { value: "SEM_RESPOSTA", label: STATUS_LABELS.SEM_RESPOSTA },
  { value: "CONVERTIDO", label: STATUS_LABELS.CONVERTIDO },
  { value: "PERDIDO", label: STATUS_LABELS.PERDIDO },
];

const STATUS_BADGE_CLASS: Record<LeadStatus, string> = {
  NOVO: "bg-blue-100 text-blue-800 border-blue-200",
  CONTACTADO: "",
  SEM_RESPOSTA: "bg-amber-100 text-amber-800 border-amber-200",
  CONVERTIDO: "bg-green-100 text-green-800 border-green-200",
  PERDIDO: "bg-red-100 text-red-800 border-red-200",
};

const dateFormat = new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });

/** O valor só muda depois de `delay` ms sem alterações (evita um pedido por tecla na pesquisa). */
function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function isOverdue(lead: Lead) {
  if (!lead.nextActionAt || lead.status === "CONVERTIDO" || lead.status === "PERDIDO") return false;
  return new Date(lead.nextActionAt).getTime() < new Date().setHours(0, 0, 0, 0);
}

export function LeadsListPage() {
  const canCreate = useCanWrite("leads");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "ALL">("ALL");
  const [kindFilter, setKindFilter] = useState<LeadKind | "">("");
  const [responsavelFilter, setResponsavelFilter] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim());
  const [dialogState, setDialogState] = useState<{ lead: Lead | null } | null>(null);

  const { data: settings } = useQuery({ queryKey: ["leads", "settings"], queryFn: getLeadSettings });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const showKind = settings?.mode === "BOTH";

  // Filtros comuns à lista e às contagens (o tipo só conta quando o filtro está visível).
  const filters: Omit<LeadFilters, "status"> = {
    kind: showKind && kindFilter ? kindFilter : undefined,
    responsavelId: responsavelFilter || undefined,
    search: debouncedSearch || undefined,
  };
  const status = statusFilter === "ALL" ? undefined : statusFilter;

  const list = useInfiniteQuery({
    queryKey: ["leads", "page", status, filters],
    queryFn: ({ pageParam }) => listLeadPage({ ...filters, status }, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const { data: counts } = useQuery({ queryKey: ["leads", "counts", filters], queryFn: () => getLeadCounts(filters) });

  const leads = list.data?.pages.flatMap((p) => p.items) ?? [];
  const countOf = (value: LeadStatus | "ALL") => (value === "ALL" ? counts?.total : (counts?.byStatus[value] ?? 0));
  const shownTotal = countOf(statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Leads</h1>
        {canCreate && <Button onClick={() => setDialogState({ lead: null })}>Novo lead</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Pesquisar leads"
          placeholder="Pesquisar por nome, empresa, NIF, email, telefone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {showKind && (
          <Select aria-label="Tipo de lead" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as LeadKind | "")} className="w-44">
            <option value="">Empresas e pessoas</option>
            <option value="COMPANY">Só empresas</option>
            <option value="PERSON">Só pessoas</option>
          </Select>
        )}
        <Select aria-label="Responsável" value={responsavelFilter} onChange={(e) => setResponsavelFilter(e.target.value)} className="w-52">
          <option value="">Todos os responsáveis</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border" role="tablist">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={tab.value === statusFilter}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium",
              tab.value === statusFilter
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {counts && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{countOf(tab.value)}</span>}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-4 py-2 font-medium">Contacto / empresa</th>
              <th className="px-4 py-2 font-medium">Origem</th>
              <th className="px-4 py-2 font-medium">Estado</th>
              <th className="px-4 py-2 font-medium">Responsável</th>
              <th className="px-4 py-2 font-medium">Próxima ação</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  A carregar...
                </td>
              </tr>
            )}
            {list.isError && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-red-600">
                  Não foi possível carregar as leads.
                </td>
              </tr>
            )}
            {!list.isLoading && !list.isError && leads.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  Nenhum lead encontrado.
                </td>
              </tr>
            )}
            {leads.map((lead) => {
              const Icon = lead.kind === "COMPANY" ? Building2 : User;
              const detail = lead.kind === "COMPANY" ? (lead.taxId ? `NIF ${lead.taxId}` : null) : lead.jobTitle;
              return (
                <tr
                  key={lead.id}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                  onClick={() => setDialogState({ lead })}
                >
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-label={lead.kind === "COMPANY" ? "Empresa" : "Pessoa"} />
                      <div>
                        <div className="font-medium">{leadTitle(lead)}</div>
                        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{leadContactLabel(lead) ?? "—"}</td>
                  <td className="px-4 py-2 text-muted-foreground">{lead.source ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Badge className={STATUS_BADGE_CLASS[lead.status]}>{STATUS_LABELS[lead.status]}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{lead.responsavel?.name ?? "—"}</td>
                  <td className={cn("px-4 py-2", isOverdue(lead) ? "font-medium text-red-600" : "text-muted-foreground")}>
                    {lead.nextActionAt ? dateFormat.format(new Date(lead.nextActionAt)) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {leads.length > 0 && shownTotal !== undefined && `A mostrar ${leads.length} de ${shownTotal}`}
        </span>
        {list.hasNextPage && (
          <Button variant="outline" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? "A carregar..." : "Carregar mais"}
          </Button>
        )}
      </div>

      {dialogState && (
        <LeadDialog open onClose={() => setDialogState(null)} lead={dialogState.lead} mode={settings?.mode ?? "BOTH"} />
      )}
    </div>
  );
}
