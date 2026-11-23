import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ServiceCase } from "@opencrm/shared-types";
import { listServiceCases, SERVICE_TYPE } from "@/lib/service-cases-api";
import { LoadMore, useDebounced, usePagedList } from "@/lib/pagination";
import { useCanWrite } from "@/lib/useCanWrite";
import { UserPicker } from "@/components/pickers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NewServiceCaseDialog } from "./NewServiceCaseDialog";

const STATES = [
  { value: "open", label: "Em aberto" },
  { value: "closed", label: "Fechadas" },
  { value: "", label: "Todas" },
] as const;

const equipment = (c: ServiceCase) => [c.brand, c.model].filter(Boolean).join(" ") || "—";
const client = (c: ServiceCase) => c.workItem.company?.name ?? c.workItem.contact?.name ?? "—";

/**
 * Assistências (Fase 4a): lista com pesquisa (número, cliente, marca, modelo, série, problema) e filtros; o quadro por
 * passos é a página do tipo «Assistência» (Fase 2b).
 */
export function ServiceCasesListPage() {
  const navigate = useNavigate();
  const canCreate = useCanWrite("dailyWork");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const [state, setState] = useState<"open" | "closed" | "">("open");
  const [assigneeId, setAssigneeId] = useState("");
  const list = usePagedList(["service-cases", "list", term, state, assigneeId], (cursor) =>
    listServiceCases({ search: term || undefined, state: state || undefined, assigneeId: assigneeId || undefined, cursor }),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Assistências</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/assistencias/indicadores">Indicadores</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/tarefas/tipo/${SERVICE_TYPE}`}>Quadro por passos</Link>
          </Button>
          {canCreate && <Button onClick={() => setCreating(true)}>Nova assistência</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Pesquisar assistências" placeholder="Número, cliente, marca, modelo, série..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <UserPicker aria-label="Responsável" value={assigneeId} onChange={(id) => setAssigneeId(id)} emptyLabel="Todos os responsáveis" className="w-56" />
        <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="Estado">
          {STATES.map((s) => (
            <button key={s.value} type="button" aria-pressed={state === s.value} onClick={() => setState(s.value)} className={cn("px-3 py-1.5 text-sm", state === s.value ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">N.º</th>
              <th className="px-4 py-2 font-medium">Assistência</th>
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Equipamento</th>
              <th className="px-4 py-2 font-medium">Passo</th>
              <th className="px-4 py-2 font-medium">Responsável</th>
              <th className="px-4 py-2 font-medium">Entrada</th>
            </tr>
          </thead>
          <tbody>
            {list.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">A carregar...</td>
              </tr>
            )}
            {!list.isLoading && list.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Nenhuma assistência.</td>
              </tr>
            )}
            {list.items.map((c) => (
              <tr key={c.workItemId} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30" onClick={() => navigate(`/assistencias/${c.workItemId}`)}>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">{c.code}</td>
                <td className="px-4 py-2 font-medium">{c.workItem.title}</td>
                <td className="px-4 py-2 text-muted-foreground">{client(c)}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {equipment(c)}
                  {c.serialNumber && <span className="block text-xs">S/N {c.serialNumber}</span>}
                </td>
                <td className="px-4 py-2">
                  <Badge className={c.workItem.status === "DONE" ? "border-green-200 bg-green-100 text-green-800" : c.workItem.status === "CANCELLED" ? "line-through" : ""}>{c.workItem.step?.name ?? c.workItem.status}</Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{c.workItem.assignee.name}</td>
                <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{new Date(c.createdAt).toLocaleDateString("pt-PT")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["assistência", "assistências"]} />

      {creating && <NewServiceCaseDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
