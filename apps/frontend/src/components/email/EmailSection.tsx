import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EmailMessage } from "@opencrm/shared-types";
import { listEmailMessages } from "@/lib/email-api";
import { Button } from "@/components/ui/button";
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
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["email-messages", { contactId, companyId }],
    queryFn: () => listEmailMessages({ contactId, companyId }),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setIsComposeOpen(true)}>
          Novo email
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">A carregar...</p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          <EmailMessageList messages={messages ?? []} onSelect={setSelected} />
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
