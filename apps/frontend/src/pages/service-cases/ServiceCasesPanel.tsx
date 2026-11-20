import { useState } from "react";
import { Link } from "react-router-dom";
import { listServiceCases, WARRANTY_LABELS } from "@/lib/service-cases-api";
import { LoadMore, usePagedList } from "@/lib/pagination";
import { useCanWrite } from "@/lib/useCanWrite";
import { Button } from "@/components/ui/button";
import type { RecordPanelProps } from "@/modules/types";
import { NewServiceCaseDialog } from "./NewServiceCaseDialog";

/** Cartão «Assistências» nas fichas de empresa e contacto (contribuição do módulo, Fase 4a): as do cliente, mais recentes primeiro. */
export function ServiceCasesPanel({ companyId, contactId }: RecordPanelProps) {
  const canCreate = useCanWrite("dailyWork");
  const [creating, setCreating] = useState(false);
  const list = usePagedList(["service-cases", "list", "of", companyId ?? null, contactId ?? null], (cursor) =>
    listServiceCases({ companyId, contactId, cursor, limit: 5 }),
  );
  return (
    <div className="space-y-2">
      {list.items.length === 0 && !list.isLoading && <p className="text-sm text-muted-foreground">Sem assistências.</p>}
      <ul className="space-y-1">
        {list.items.map((c) => (
          <li key={c.workItemId} className="text-sm">
            <Link to={`/assistencias/${c.workItemId}`} className="hover:underline">
              <span className="mr-1 font-mono text-xs text-muted-foreground">{c.code}</span>
              {c.workItem.title}
            </Link>
            <span className="block text-xs text-muted-foreground">
              {c.workItem.step?.name ?? c.workItem.status} · {WARRANTY_LABELS[c.underWarranty]}
            </span>
          </li>
        ))}
      </ul>
      <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["assistência", "assistências"]} />
      {canCreate && (
        <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
          Nova assistência
        </Button>
      )}
      {creating && <NewServiceCaseDialog onClose={() => setCreating(false)} companyId={companyId} contactId={contactId} />}
    </div>
  );
}
