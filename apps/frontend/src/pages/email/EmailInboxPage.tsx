import { useState } from "react";
import type { EmailMessage } from "@opencrm/shared-types";
import { listEmailMessages } from "@/lib/email-api";
import { Button } from "@/components/ui/button";
import { useCanWrite } from "@/lib/useCanWrite";
import { LoadMore, useDebounced, usePagedList } from "@/lib/pagination";
import { Input } from "@/components/ui/input";
import { EmailMessageList } from "@/components/email/EmailMessageList";
import { EmailMessageDetail } from "@/components/email/EmailMessageDetail";
import { ComposeEmailDialog } from "./ComposeEmailDialog";

export function EmailInboxPage() {
  const canSend = useCanWrite("sendEmail");
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  // Paginada (mais recentes primeiro) e com pesquisa: a caixa partilhada acumula anos de mensagens.
  const list = usePagedList(["email-messages", "inbox", term], (cursor) => listEmailMessages({ search: term || undefined, cursor, limit: 30 }), {
    refetchInterval: 30000,
  });

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Email</h1>
        {canSend && <Button onClick={() => setIsComposeOpen(true)}>Novo email</Button>}
      </div>

      <div className="grid flex-1 grid-cols-[320px_1fr] overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex flex-col overflow-hidden border-r border-border">
          <div className="border-b border-border p-2">
            <Input aria-label="Pesquisar emails" placeholder="Pesquisar assunto, remetente..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex-1 overflow-y-auto">
            {list.isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">A carregar...</p>
            ) : (
              <EmailMessageList messages={list.items} selectedId={selected?.id} onSelect={setSelected} />
            )}
            <div className="px-3">
              <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["mensagem", "mensagens"]} />
            </div>
          </div>
        </div>
        <div className="overflow-y-auto p-4">
          {selected ? (
            <EmailMessageDetail message={selected} />
          ) : (
            <p className="text-sm text-muted-foreground">Seleciona uma mensagem para ver o conteúdo.</p>
          )}
        </div>
      </div>

      <ComposeEmailDialog open={isComposeOpen} onClose={() => setIsComposeOpen(false)} />
    </div>
  );
}
