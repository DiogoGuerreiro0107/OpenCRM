import type { ReactNode } from "react";
import type { Role } from "@opencrm/shared-types";
import { useAuth } from "@/lib/AuthContext";
import { hasRole } from "@/lib/permissions";

/** Mostra os filhos só se o papel do utilizador estiver na lista; senão uma mensagem clara. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!hasRole(user?.role, roles)) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-border bg-background p-6 text-center">
        <h1 className="text-lg font-semibold">Sem permissão</h1>
        <p className="mt-2 text-sm text-muted-foreground">O teu papel não tem acesso a esta página.</p>
      </div>
    );
  }
  return <>{children}</>;
}
