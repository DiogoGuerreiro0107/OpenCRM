/** Dono das ligações a ids externos criadas pela API pública: a própria chave (duas integrações não colidem). */
export const apiKeyProvider = (apiKeyId: string) => `api_key:${apiKeyId}`;
