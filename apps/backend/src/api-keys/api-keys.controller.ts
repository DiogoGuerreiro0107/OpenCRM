import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles, WriteRoles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { API_SCOPES } from "../public-api/scopes";
import { OPENAPI_SPEC } from "../public-api/openapi";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

/** Gestão das chaves de API (só o Administrador, com a sessão da interface). Não confundir com a `/api/v1`. */
@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...ADMIN_ONLY)
@Controller("api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Roles(...ADMIN_ONLY)
  @Get()
  list() {
    return this.apiKeys.list();
  }

  /** Os âmbitos que se podem dar a uma chave, com a descrição (para o formulário de criação). */
  @Roles(...ADMIN_ONLY)
  @Get("scopes")
  scopes() {
    return Object.entries(API_SCOPES).map(([scope, description]) => ({ scope, description }));
  }

  /** A especificação OpenAPI da `/api/v1`, para o Administrador a descarregar e entregar a quem integra. */
  @Roles(...ADMIN_ONLY)
  @Get("openapi.json")
  openapi() {
    return OPENAPI_SPEC;
  }

  @Audit("api_key.created", { target: "api_key", fields: ["name", "scopes", "expiresAt", "rateLimitPerMinute"] })
  @Post()
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() user: { userId: string }) {
    return this.apiKeys.create(dto, user.userId);
  }

  @Audit("api_key.revoked", { target: "api_key" })
  @HttpCode(HttpStatus.OK)
  @Post(":id/revoke")
  revoke(@Param("id") id: string) {
    return this.apiKeys.revoke(id);
  }
}
