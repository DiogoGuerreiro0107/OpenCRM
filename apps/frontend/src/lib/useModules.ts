import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { getEnabledModules, type ModuleId } from "@/lib/modules-api";

/**
 * Módulos opcionais ativos. Atualiza em tempo real (o servidor avisa quando o Administrador liga/desliga um módulo).
 * Enquanto carrega, NENHUM módulo conta como ativo — os itens opcionais ficam escondidos em vez de piscarem e
 * desaparecerem.
 */
export function useModules() {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ["modules"], queryFn: getEnabledModules, enabled: !!user, staleTime: 60_000 });
  return { enabled: new Set<ModuleId>(query.data ?? []), isLoading: query.isLoading };
}

export function useModuleEnabled(id: ModuleId) {
  return useModules().enabled.has(id);
}
