import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LeadMode } from "@opencrm/shared-types";
import { getLeadSettings, updateLeadSettings } from "@/lib/leads-api";
import { errorMessage } from "@/lib/errors";
import { Select } from "@/components/ui/select";

const MODE_LABELS: Record<LeadMode, string> = {
  BOTH: "Empresas e pessoas",
  COMPANY: "Só empresas",
  PERSON: "Só pessoas",
};

/** Modo do módulo de leads (Fase 1): que tipo de lead se pode criar. Mostrado no cartão do módulo (só Administrador). */
export function LeadModeSetting() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["leads", "settings"], queryFn: getLeadSettings });
  const save = useMutation({
    mutationFn: updateLeadSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });

  return (
    <div className="space-y-1 pt-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Tipo de leads:</span>
        <Select
          aria-label="Tipo de leads"
          className="h-8 w-48"
          value={data?.mode ?? ""}
          disabled={!data || save.isPending}
          onChange={(e) => save.mutate(e.target.value as LeadMode)}
        >
          {Object.entries(MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-xs text-muted-foreground">
        Só muda o que se pode criar; as leads que já existem ficam como estão.
      </p>
      {save.isError && <p className="text-xs text-red-600">{errorMessage(save.error, "Não foi possível alterar o tipo de leads.")}</p>}
    </div>
  );
}
