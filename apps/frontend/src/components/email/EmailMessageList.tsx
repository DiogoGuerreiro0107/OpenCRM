import type { EmailMessage } from "@opencrm/shared-types";
import { cn } from "@/lib/utils";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

interface EmailMessageListProps {
  messages: EmailMessage[];
  selectedId?: string;
  onSelect: (message: EmailMessage) => void;
}

export function EmailMessageList({ messages, selectedId, onSelect }: EmailMessageListProps) {
  if (messages.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">Nenhuma mensagem encontrada.</p>;
  }

  return (
    <div className="divide-y divide-border">
      {messages.map((message) => (
        <button
          key={message.id}
          onClick={() => onSelect(message)}
          className={cn(
            "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/40",
            selectedId === message.id && "bg-muted/60",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">
              {message.direction === "OUTBOUND" ? message.toAddresses.join(", ") : message.fromName || message.fromAddress}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatDate(message.sentAt)}</span>
          </div>
          <span className="truncate text-muted-foreground">{message.subject || "(sem assunto)"}</span>
        </button>
      ))}
    </div>
  );
}
