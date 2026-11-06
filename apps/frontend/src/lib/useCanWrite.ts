import { useAuth } from "@/lib/AuthContext";
import { canWrite, type WriteArea } from "@/lib/permissions";

/** O utilizador com sessão iniciada pode alterar esta área? (só conforto de UI; o backend decide de verdade) */
export function useCanWrite(area: WriteArea) {
  const { user } = useAuth();
  return canWrite(user?.role, area);
}
