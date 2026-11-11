import { Controller, Get, Req, UseFilters, UseGuards } from "@nestjs/common";
import { ApiKeyGuard, AuthenticatedApiKey } from "./api-key.guard";
import { Scopes } from "./scopes.decorator";
import { V1ExceptionFilter } from "./v1-error.filter";

/**
 * API PÚBLICA v1. Autenticação SÓ por chave de API (nunca JWT). Contrato e política de versões: docs/api-publica.md.
 * Cada rota tem de declarar @Scopes(...) (teste estrutural). Dentro da v1 só se acrescenta.
 */

@UseGuards(ApiKeyGuard)
@UseFilters(V1ExceptionFilter)
@Controller("api/v1")
export class V1MetaController {
  /** «Quem sou eu?»: valida a chave e mostra os âmbitos. Qualquer chave válida. */
  @Scopes()
  @Get("ping")
  ping(@Req() request: { apiKey: AuthenticatedApiKey }) {
    const { id, name, scopes } = request.apiKey;
    return { data: { api_version: "v1", server_time: new Date().toISOString(), api_key: { id, name, scopes } } };
  }
}
