import { Controller, Get, Param, Query, UseFilters, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "./api-key.guard";
import { PublicApiService } from "./public-api.service";
import { Scopes } from "./scopes.decorator";
import { V1ExceptionFilter } from "./v1-error.filter";
import { V1ListQueryDto } from "./dto/v1-list-query.dto";

/**
 * API PÚBLICA v1. Autenticação SÓ por chave de API (nunca JWT). Contrato e política de versões: docs/api-publica.md.
 * Cada rota tem de declarar @Scopes(...) (teste estrutural). Dentro da v1 só se acrescenta.
 */

@UseGuards(ApiKeyGuard)
@UseFilters(V1ExceptionFilter)
@Controller("api/v1")
export class V1CrmController {
  constructor(private readonly service: PublicApiService) {}

  @Scopes("companies:read")
  @Get("companies")
  listCompanies(@Query() query: V1ListQueryDto) {
    return this.service.listCompanies(query);
  }

  @Scopes("companies:read")
  @Get("companies/:id")
  getCompany(@Param("id") id: string) {
    return this.service.getCompany(id);
  }

  @Scopes("contacts:read")
  @Get("contacts")
  listContacts(@Query() query: V1ListQueryDto) {
    return this.service.listContacts(query);
  }

  @Scopes("contacts:read")
  @Get("contacts/:id")
  getContact(@Param("id") id: string) {
    return this.service.getContact(id);
  }
}
