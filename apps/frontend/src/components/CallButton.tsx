import { useMutation } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { makeZadarmaCall } from "@/lib/zadarma-api";

interface CallButtonProps {
  phoneNumber: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export function CallButton({ phoneNumber, contactId, companyId, dealId }: CallButtonProps) {
  const callMutation = useMutation({
    mutationFn: () => makeZadarmaCall(phoneNumber, { contactId, companyId, dealId }),
  });

  if (!phoneNumber.trim()) return null;

  return (
    <button
      type="button"
      title={`Ligar para ${phoneNumber} via Zadarma`}
      className="text-muted-foreground hover:text-primary disabled:opacity-50"
      disabled={callMutation.isPending}
      onClick={() => {
        if (confirm(`Ligar para ${phoneNumber} através da Zadarma?`)) {
          callMutation.mutate();
        }
      }}
    >
      <Phone className="h-4 w-4" />
    </button>
  );
}
