import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listExtensions } from "@/lib/modules-api";
import { listInstalledExtensions } from "@/lib/extensions-api";
import { ExtensionSettingsForm } from "@/components/ExtensionSettingsForm";
import { Card, CardContent } from "@/components/ui/card";

/** Configurações > definições de uma extensão (Fase E1.3), geradas a partir do manifesto. */
export function ExtensionSettingsPage() {
  const { id = "" } = useParams();
  const { data: builtins } = useQuery({ queryKey: ["modules", "extensions"], queryFn: listExtensions });
  const { data: installed } = useQuery({ queryKey: ["modules", "installed"], queryFn: listInstalledExtensions });
  const extensions = builtins && installed ? [...builtins, ...installed.extensions.map((e) => ({ ...e, enabled: e.status === "enabled" }))] : undefined;
  const extension = extensions?.find((e) => e.id === id);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link to="/configuracoes/modulos" className="text-xs text-muted-foreground hover:underline">
          ← Módulos e extensões
        </Link>
        <h1 className="text-2xl font-semibold">{extension ? extension.name : "Definições"}</h1>
        {extension && !extension.enabled && <p className="text-sm text-amber-700">Esta extensão está desligada: podes prepará-la antes de a ligar.</p>}
        <p className="text-sm text-muted-foreground">As palavras-passe e chaves ficam cifradas e nunca se mostram depois de guardadas.</p>
      </div>
      <Card>
        <CardContent className="p-4">
          {extensions && !extension ? (
            <p className="text-sm text-muted-foreground">Extensão não encontrada.</p>
          ) : extension && !extension.hasSettings ? (
            <p className="text-sm text-muted-foreground">Esta extensão não tem definições.</p>
          ) : (
            <ExtensionSettingsForm extensionId={id} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
