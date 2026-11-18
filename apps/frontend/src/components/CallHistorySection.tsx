import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { listCallRecords } from "@/lib/zadarma-api";
import { LoadMore, usePagedList } from "@/lib/pagination";

interface CallHistorySectionProps {
  contactId?: string;
  companyId?: string;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function CallHistorySection({ contactId, companyId }: CallHistorySectionProps) {
  // Paginado (mais recentes primeiro): um registo com anos de chamadas não as descarrega todas.
  const list = usePagedList(["call-records", { contactId, companyId }], (cursor) => listCallRecords({ contactId, companyId, cursor, limit: 20 }));
  const calls = list.items;

  if (list.isLoading) return <p className="text-sm text-muted-foreground">A carregar...</p>;

  if (calls.length === 0) {
    return <p className="text-sm text-muted-foreground">Ainda sem chamadas registadas.</p>;
  }

  return (
    <div className="max-h-72 space-y-2 overflow-y-auto">
      {calls.map((call) => (
        <div key={call.id} className="flex items-center gap-3 rounded-md border border-border p-2 text-sm">
          {call.direction === "INBOUND" ? (
            <PhoneIncoming className="h-4 w-4 shrink-0 text-green-600" />
          ) : (
            <PhoneOutgoing className="h-4 w-4 shrink-0 text-blue-600" />
          )}
          <div className="flex-1">
            <p className="font-medium">{call.direction === "INBOUND" ? call.fromNumber : call.toNumber}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(call.startedAt).toLocaleString("pt-PT")} · {formatDuration(call.duration)}
              {call.disposition ? ` · ${call.disposition}` : ""}
            </p>
          </div>
          {call.recordingUrl && (
            <a
              href={call.recordingUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Gravação
            </a>
          )}
        </div>
      ))}
      <LoadMore shown={calls.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["chamada", "chamadas"]} label="Ver mais" />
    </div>
  );
}
