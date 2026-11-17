import type { ApiKeyView, ApiScopeInfo, CreatedApiKey } from "@opencrm/shared-types";
import { api } from "./api";

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  /** ISO 8601; sem valor = não expira. */
  expiresAt?: string;
  rateLimitPerMinute?: number;
}

export async function listApiKeys() {
  const { data } = await api.get<ApiKeyView[]>("/api-keys");
  return data;
}

export async function listApiScopes() {
  const { data } = await api.get<ApiScopeInfo[]>("/api-keys/scopes");
  return data;
}

/** A resposta traz a chave completa UMA única vez. */
export async function createApiKey(input: CreateApiKeyInput) {
  const { data } = await api.post<CreatedApiKey>("/api-keys", input);
  return data;
}

export async function revokeApiKey(id: string) {
  const { data } = await api.post<ApiKeyView>(`/api-keys/${id}/revoke`);
  return data;
}

/** Descarrega a especificação OpenAPI da `/api/v1` como ficheiro (para entregar a quem integra). */
export async function downloadOpenApiSpec() {
  const { data } = await api.get<object>("/api-keys/openapi.json");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "opencrm-api-v1.openapi.json";
  link.click();
  URL.revokeObjectURL(url);
}
