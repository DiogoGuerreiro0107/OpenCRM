import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EmailMessage } from "@opencrm/shared-types";
import { listEmailMessages } from "@/lib/email-api";
import { Button } from "@/components/ui/button";
import { EmailMessageList } from "@/components/email/EmailMessageList";
import { EmailMessageDetail } from "@/components/email/EmailMessageDetail";
import { ComposeEmailDialog } from "./ComposeEmailDialog";

export function EmailInboxPage() {
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["email-messages"],
    queryFn: () => listEmailMessages(),
    refetchInterval: 30000,
  });

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Email</h1>
        <Button onClick={() => setIsComposeOpen(true)}>Novo email</Button>
      </div>

      <div className="grid flex-1 grid-cols-[320px_1fr] overflow-hidden rounded-lg border border-border bg-background">
        <div className="overflow-y-auto border-r border-border">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">A carregar...</p>
          ) : (
            <EmailMessageList messages={messages ?? []} selectedId={selected?.id} onSelect={setSelected} />
          )}
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
