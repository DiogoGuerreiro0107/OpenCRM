import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { getMyPermissions } from "@/lib/permissions-api";
import type { WriteArea } from "@/lib/permissions";

/**
 * As permissões de escrita do utilizador com sessão, vindas do backend (configuráveis, Fase 0d). Atualizam-se em
 * tempo real quando o Administrador as muda (lib/realtime.ts invalida a chave ["permissions"]).
 */
export function useMyPermissions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["permissions", "me", user?.id],
    queryFn: getMyPermissions,
    enabled: !!user,
    staleTime: 60_000,
  });
}

/**
 * O utilizador pode alterar esta área? Só conforto de UI (o backend decide de verdade). Enquanto as permissões
 * carregam devolve `false`: os botões aparecem depois, em vez de aparecerem e desaparecerem.
 */
export function useCanWrite(area: WriteArea) {
  const { data } = useMyPermissions();
  return !!data?.writeAreas.includes(area);
}
