import { io } from "socket.io-client";
import type { QueryClient } from "@tanstack/react-query";
import { api, getAccessToken } from "./api";

/**
 * Que consultas refazer quando o servidor avisa que mudou algo num "recurso". O evento não traz dados — só
 * "mudou alguma coisa em deals" — e o browser refaz o pedido HTTP normal (sujeito às permissões do utilizador).
 *
 * ESCOLHA DELIBERADA: não se invalidam as fichas de empresa e de contacto. Os formulários delas copiam os dados da
 * consulta para estado local, e uma atualização a meio da escrita apagava o que a pessoa estava a editar. Dos
 * diálogos (lead, negócio, tarefa) não há esse risco: trabalham sobre uma cópia que não vem da consulta.
 */
const KEYS_BY_RESOURCE: Record<string, string[]> = {
  deals: ["deals", "pipelines", "dashboard-summary"],
  pipelines: ["pipelines", "deals", "dashboard-summary"],
  tasks: ["tasks", "dashboard-summary"],
  leads: ["leads", "dashboard-summary"],
  companies: ["dashboard-summary"],
  contacts: ["dashboard-summary"],
  timeline: ["timeline"],
  email: ["email-messages"],
  "custom-fields": ["custom-fields", "custom-field-values"],
  zadarma: ["call-records"],
  users: ["users"],
  // Um administrador ligou/desligou um módulo: menu, rotas e dashboard de todas as sessões atualizam-se.
  modules: ["modules", "dashboard-summary"],
  "api-keys": ["api-keys"],
  webhooks: ["webhooks"],
};

/** Junta rajadas de eventos (ex.: uma automação + o pedido que a causou) num só refrescamento. */
const DEBOUNCE_MS = 300;
/** Espera antes de voltar a tentar depois de o servidor recusar a ligação (token expirado). */
const RETRY_AFTER_REJECTION_MS = 5000;

/** Liga ao canal de tempo real e mantém as consultas atualizadas. Devolve a função que o desliga. */
export function startRealtime(queryClient: QueryClient): () => void {
  let stopped = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingKeys = new Set<string>();

  // `auth` como função é reavaliada em cada (re)ligação: usa sempre o token de acesso ATUAL (expira em 15 min).
  const socket = io(api.defaults.baseURL ?? "", {
    auth: (callback) => callback({ token: getAccessToken() }),
    reconnectionDelayMax: 10_000,
  });

  function flush() {
    flushTimer = undefined;
    for (const key of pendingKeys) queryClient.invalidateQueries({ queryKey: [key] });
    pendingKeys.clear();
  }

  socket.on("crm:event", (event: { resource?: string }) => {
    for (const key of KEYS_BY_RESOURCE[event.resource ?? ""] ?? []) pendingKeys.add(key);
    if (pendingKeys.size > 0 && !flushTimer) flushTimer = setTimeout(flush, DEBOUNCE_MS);
  });

  socket.on("connect_error", async () => {
    // Quando o servidor RECUSA a ligação (ex.: token expirado) o socket.io não volta a tentar sozinho.
    if (socket.active || stopped) return;
    try {
      // Qualquer pedido autenticado faz o axios renovar o token se estiver expirado.
      await api.get("/auth/me");
    } catch {
      // sem sessão válida: o AuthContext tratará do logout; não insistimos.
      return;
    }
    if (!stopped) retryTimer = setTimeout(() => socket.connect(), RETRY_AFTER_REJECTION_MS);
  });

  return () => {
    stopped = true;
    clearTimeout(flushTimer);
    clearTimeout(retryTimer);
    socket.close();
  };
}
