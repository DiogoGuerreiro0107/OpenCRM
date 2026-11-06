import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listModules, setModuleEnabled, type ModuleId, type ModuleView } from "@/lib/modules-api";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function ModulesSettingsPage() {
  const queryClient = useQueryClient();
  const { data: modules, isLoading } = useQuery({ queryKey: ["modules", "manage"], queryFn: listModules });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: ModuleId; enabled: boolean }) => setModuleEnabled(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["modules"] }),
  });

  const labelOf = (id: ModuleId) => modules?.find((m) => m.id === id)?.label ?? id;

  function hint(module: ModuleView) {
    if (module.enabled && module.activeDependents.length > 0) {
      return `Para desligar, desliga primeiro: ${module.activeDependents.map(labelOf).join(", ")}.`;
    }
    if (!module.enabled && module.dependsOn.some((dep) => !modules?.find((m) => m.id === dep)?.enabled)) {
      return `Para ligar, liga primeiro: ${module.dependsOn.filter((dep) => !modules?.find((m) => m.id === dep)?.enabled).map(labelOf).join(", ")}.`;
    }
    return module.dependsOn.length > 0 ? `Depende de: ${module.dependsOn.map(labelOf).join(", ")}.` : null;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Módulos</h1>
        <p className="text-sm text-muted-foreground">
          Liga só o que a tua empresa usa. Desligar um módulo esconde-o e bloqueia-o para toda a gente, mas{" "}
          <strong>nunca apaga dados</strong>: ao voltar a ligar tudo reaparece. As empresas, contactos, tarefas, campos
          personalizados e o dashboard fazem parte do núcleo e estão sempre ativos.
        </p>
      </div>

      {toggle.isError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage(toggle.error, "Não foi possível alterar o módulo.")}
        </p>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}

      <div className="space-y-3">
        {modules?.map((module) => (
          <Card key={module.id}>
            <CardContent className="flex items-start justify-between gap-4 p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium">{module.label}</h2>
                  <Badge className={module.enabled ? "border-green-200 bg-green-100 text-green-800" : ""}>
                    {module.enabled ? "Ativo" : "Desligado"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{module.description}</p>
                {hint(module) && <p className="text-xs text-muted-foreground">{hint(module)}</p>}
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={`${module.enabled ? "Desligar" : "Ligar"} ${module.label}`}
                  checked={module.enabled}
                  disabled={toggle.isPending}
                  onChange={(e) => toggle.mutate({ id: module.id, enabled: e.target.checked })}
                />
                {module.enabled ? "Ligado" : "Desligado"}
              </label>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
