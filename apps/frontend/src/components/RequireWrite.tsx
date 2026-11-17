import type { ReactNode } from "react";
import { useCanWrite, useMyPermissions } from "@/lib/useCanWrite";
import type { WriteArea } from "@/lib/permissions";

/** Como <RequireRole>, mas para uma área de escrita configurável (Fase 0d). */
export function RequireWrite({ area, children }: { area: WriteArea; children: ReactNode }) {
  const { isLoading } = useMyPermissions();
  const allowed = useCanWrite(area);
  if (isLoading) return <p className="text-sm text-muted-foreground">A carregar...</p>;
  if (!allowed) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-border bg-background p-6 text-center">
        <h1 className="text-lg font-semibold">Sem permissão</h1>
        <p className="mt-2 text-sm text-muted-foreground">O teu papel não tem acesso a esta página.</p>
      </div>
    );
  }
  return <>{children}</>;
}
