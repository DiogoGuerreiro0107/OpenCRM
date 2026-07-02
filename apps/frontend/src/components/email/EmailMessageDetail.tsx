import { useQuery } from "@tanstack/react-query";
import type { EmailMessage } from "@opencrm/shared-types";
import { getAttachmentDownloadUrl } from "@/lib/email-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-PT", { dateStyle: "medium", timeStyle: "short" });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function AttachmentRow({ attachment }: { attachment: EmailMessage["attachments"][number] }) {
  const { data: url, refetch, isFetching } = useQuery({
    queryKey: ["attachment-url", attachment.id],
    queryFn: () => getAttachmentDownloadUrl(attachment.id),
    enabled: false,
  });

  async function handleDownload() {
    const result = await refetch();
    if (result.data) window.open(result.data, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
      <span className="truncate">
        {attachment.filename} <span className="text-muted-foreground">({formatSize(attachment.size)})</span>
      </span>
      <Button variant="outline" size="sm" onClick={handleDownload} disabled={isFetching}>
        {isFetching ? "..." : "Transferir"}
      </Button>
      {url && <span className="hidden">{url}</span>}
    </div>
  );
}

export function EmailMessageDetail({ message }: { message: EmailMessage }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1 border-b border-border pb-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{message.subject || "(sem assunto)"}</h2>
          <Badge>{message.direction === "INBOUND" ? "Recebido" : "Enviado"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          De: {message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress}
        </p>
        <p className="text-sm text-muted-foreground">Para: {message.toAddresses.join(", ")}</p>
        <p className="text-xs text-muted-foreground">{formatDate(message.sentAt)}</p>
        {(message.contact || message.company) && (
          <p className="text-xs text-muted-foreground">
            Associado a: {message.company?.name}
            {message.company && message.contact && " · "}
            {message.contact?.name}
          </p>
        )}
      </div>

      {message.htmlBody ? (
        <iframe
          title="email-body"
          sandbox=""
          srcDoc={message.htmlBody}
          className="h-96 w-full rounded-md border border-border bg-white"
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm">{message.textBody}</p>
      )}

      {message.attachments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Anexos ({message.attachments.length})</p>
          {message.attachments.map((attachment) => (
            <AttachmentRow key={attachment.id} attachment={attachment} />
          ))}
        </div>
      )}
    </div>
  );
}
