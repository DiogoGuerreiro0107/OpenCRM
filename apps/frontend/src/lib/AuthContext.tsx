import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AuthUser } from "@opencrm/shared-types";
import { clearTokens, getAccessToken, setTokens } from "./api";
import { fetchCurrentUser, login as loginRequest, logoutRequest } from "./auth-api";
import { startRealtime } from "./realtime";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  // Atualizações ao vivo enquanto houver sessão iniciada (ver lib/realtime.ts).
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    return startRealtime(queryClient);
  }, [userId, queryClient]);

  useEffect(() => {
    if (!getAccessToken()) {
      setIsLoading(false);
      return;
    }
    fetchCurrentUser()
      .then(setUser)
      .catch(() => clearTokens())
      .finally(() => setIsLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const data = await loginRequest(email, password);
    setTokens(data.accessToken, data.refreshToken);
    setUser(data.user);
  }

  async function logout() {
    try {
      await logoutRequest();
    } finally {
      clearTokens();
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de um AuthProvider");
  return ctx;
}
