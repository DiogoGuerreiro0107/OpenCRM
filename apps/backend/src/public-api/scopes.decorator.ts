import { SetMetadata } from "@nestjs/common";
import { ApiScope } from "./scopes";

export const SCOPES_KEY = "apiScopes";

/**
 * Âmbitos que a chave tem de ter para chamar a rota. `@Scopes()` (vazio) = qualquer chave válida.
 * Obrigatório em toda a rota `/api/v1` (teste estrutural: public-api-coverage.spec.ts).
 */
export const Scopes = (...scopes: ApiScope[]) => SetMetadata(SCOPES_KEY, scopes);
