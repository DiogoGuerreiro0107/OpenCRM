import type { ReactNode } from "react";
import type { ModuleId } from "@/lib/modules-api";
import { useModules } from "@/lib/useModules";

/** Mostra os filhos só se o módulo estiver ativo; senão uma mensagem clara (ex.: quem tinha a página nos favoritos). */
export function RequireModule({ id, children }: { id: ModuleId; children: ReactNode }) {
  const { enabled, isLoading } = useModules();
  if (isLoading) return <p className="text-muted-foreground">A carregar...</p>;
  if (!enabled.has(id)) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-border bg-background p-6 text-center">
        <h1 className="text-lg font-semibold">Módulo desligado</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Esta funcionalidade não está ativa. Um Administrador pode ligá-la em Configurações &gt; Módulos.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
