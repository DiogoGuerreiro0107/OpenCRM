import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { listAudit, type AuditFilters } from "@/lib/audit-api";
import { actionLabel, ACTION_GROUPS } from "@/lib/audit-labels";
import { listManagedUsers } from "@/lib/users-api";
import { errorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const formatDate = (iso: string) => new Date(iso).toLocaleString("pt-PT");

/** `<input type="date">` devolve AAAA-MM-DD: converte para o início/fim desse dia (hora local). */
const startOfDay = (date: string) => (date ? new Date(`${date}T00:00:00`).toISOString() : undefined);
const endOfDay = (date: string) => (date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined);

export function AuditPage() {
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filters: AuditFilters = { action, actorId, from: startOfDay(from), to: endOfDay(to) };
  const users = useQuery({ queryKey: ["users", "manage"], queryFn: listManagedUsers });
  const audit = useInfiniteQuery({
    queryKey: ["audit", filters],
    queryFn: ({ pageParam }) => listAudit(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const events = audit.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Auditoria</h1>
        <p className="text-sm text-muted-foreground">
          Quem fez o quê nas configurações e nas contas. O registo <strong>só se acrescenta</strong>: ninguém o pode
          alterar nem apagar a partir da aplicação. Nunca guarda passwords, chaves nem o conteúdo de segredos.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Tipo de ação</span>
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Todas</option>
              {ACTION_GROUPS.map((g) => (
                <option key={g.prefix} value={g.prefix}>
                  {g.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Quem</span>
            <Select value={actorId} onChange={(e) => setActorId(e.target.value)}>
              <option value="">Todos</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Desde</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Até</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </CardContent>
      </Card>

      {audit.isError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage(audit.error, "Não foi possível carregar o registo.")}
        </p>
      )}
      {audit.isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}
      {!audit.isLoading && !audit.isError && events.length === 0 && (
        <p className="text-sm text-muted-foreground">Sem eventos para estes filtros.</p>
      )}

      {events.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Data</th>
                  <th className="px-4 py-2">Quem</th>
                  <th className="px-4 py-2">Ação</th>
                  <th className="px-4 py-2">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-2">{formatDate(e.createdAt)}</td>
                    <td className="px-4 py-2">
                      {e.actorName ?? <span className="text-muted-foreground">Sistema / sem sessão</span>}
                      {e.ip && <div className="text-xs text-muted-foreground">{e.ip}</div>}
                    </td>
                    <td className="px-4 py-2">
                      {actionLabel(e.action)}
                      {e.targetId && (
                        <div className="text-xs text-muted-foreground" title={e.targetId}>
                          {e.targetType ?? "alvo"} · {e.targetId.slice(0, 8)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {e.metadata ? <code className="break-all">{JSON.stringify(e.metadata)}</code> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {audit.hasNextPage && (
        <div className="text-center">
          <Button variant="outline" onClick={() => audit.fetchNextPage()} disabled={audit.isFetchingNextPage}>
            {audit.isFetchingNextPage ? "A carregar..." : "Carregar mais"}
          </Button>
        </div>
      )}
    </div>
  );
}
