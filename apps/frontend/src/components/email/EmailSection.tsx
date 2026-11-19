import { useState } from "react";
import type { EmailMessage } from "@opencrm/shared-types";
import { listEmailMessages } from "@/lib/email-api";
import { LoadMore, usePagedList } from "@/lib/pagination";
import { Button } from "@/components/ui/button";
import { useCanWrite } from "@/lib/useCanWrite";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmailMessageList } from "./EmailMessageList";
import { EmailMessageDetail } from "./EmailMessageDetail";
import { ComposeEmailDialog } from "@/pages/email/ComposeEmailDialog";

interface EmailSectionProps {
  contactId?: string;
  companyId?: string;
  defaultTo?: string;
}

export function EmailSection({ contactId, companyId, defaultTo }: EmailSectionProps) {
  const canSend = useCanWrite("sendEmail");
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  const list = usePagedList(["email-messages", { contactId, companyId }], (cursor) => listEmailMessages({ contactId, companyId, cursor, limit: 20 }));

  return (
    <div className="space-y-3">
      {canSend && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setIsComposeOpen(true)}>
            Novo email
          </Button>
        </div>
      )}

      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar...</p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          <EmailMessageList messages={list.items} onSelect={setSelected} />
          <div className="px-3">
            <LoadMore shown={list.items.length} hasMore={list.hasNextPage} loading={list.isFetchingNextPage} onMore={() => list.fetchNextPage()} noun={["mensagem", "mensagens"]} label="Ver mais" />
          </div>
        </div>
      )}

      <Dialog open={!!selected} onClose={() => setSelected(null)} className="max-w-2xl">
        {selected && <EmailMessageDetail message={selected} />}
      </Dialog>

      <ComposeEmailDialog
        open={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        defaultTo={defaultTo}
        contactId={contactId}
        companyId={companyId}
      />
    </div>
  );
}
