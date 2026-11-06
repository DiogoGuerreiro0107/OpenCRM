import { useMutation } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { makeZadarmaCall } from "@/lib/zadarma-api";
import { useCanWrite } from "@/lib/useCanWrite";
import { useModuleEnabled } from "@/lib/useModules";

interface CallButtonProps {
  phoneNumber: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export function CallButton({ phoneNumber, contactId, companyId, dealId }: CallButtonProps) {
  const canCall = useCanWrite("makeCall");
  const telephonyOn = useModuleEnabled("zadarma");
  const callMutation = useMutation({
    mutationFn: () => makeZadarmaCall(phoneNumber, { contactId, companyId, dealId }),
  });

  if (!telephonyOn || !canCall || !phoneNumber.trim()) return null;

  function call() {
    if (callMutation.isPending) return;
    if (confirm(`Ligar para ${phoneNumber} através da Zadarma?`)) {
      callMutation.mutate();
    }
  }

  // Propositadamente um <span role="button"> e não um <button>: este botão vive dentro de formulários de ficha
  // (contacto, empresa, lead) que ficam em <fieldset disabled> para quem não os pode editar — e um <button>
  // seria desativado com eles. Quem pode ligar (ex.: Técnico) nem sempre pode editar a ficha.
  return (
    <span
      role="button"
      tabIndex={0}
      title={`Ligar para ${phoneNumber} via Zadarma`}
      aria-label={`Ligar para ${phoneNumber}`}
      aria-disabled={callMutation.isPending}
      className="cursor-pointer text-muted-foreground hover:text-primary aria-disabled:opacity-50"
      onClick={call}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          call();
        }
      }}
    >
      <Phone className="h-4 w-4" />
    </span>
  );
}
