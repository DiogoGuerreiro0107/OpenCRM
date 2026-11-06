import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Agrupa campos de formulário e, quando `disabled`, desativa-os todos de uma vez (o HTML faz isto nativamente
 * com `<fieldset disabled>`: campos, selects e botões lá dentro) e mostra uma faixa a explicar porquê.
 *
 * Atenção: um fieldset desativado NÃO se volta a ativar para descendentes — por isso envolve só os campos
 * próprios da ficha, nunca as secções embebidas (timeline, campos personalizados) que têm permissões diferentes.
 */
export function ReadOnlyFieldset({
  disabled,
  className,
  children,
}: {
  disabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset disabled={disabled} className={cn("m-0 min-w-0 space-y-4 border-0 p-0", className)}>
      {disabled && <ReadOnlyNotice />}
      {children}
    </fieldset>
  );
}

export function ReadOnlyNotice() {
  return (
    <p className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Lock className="h-3.5 w-3.5 shrink-0" />O teu papel só pode consultar esta informação.
    </p>
  );
}
