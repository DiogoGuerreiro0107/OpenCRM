import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles, WriteRoles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { ExtensionsService } from "./extensions.service";
import { ExtensionSettingsService } from "./extension-settings.service";

/**
 * Extensões (Fase E1.1) e as suas definições (E1.3): só o Administrador. Ligar/desligar continua em PATCH /modules/:id.
 * As definições de uma extensão desligada também se veem e alteram (para a preparar antes de a ligar).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ONLY)
@WriteRoles(...ADMIN_ONLY)
@Controller("extensions")
export class ExtensionsController {
  constructor(
    private readonly extensions: ExtensionsService,
    private readonly settings: ExtensionSettingsService,
  ) {}

  @Get()
  list() {
    return this.extensions.list();
  }

  @Get(":id/settings")
  getSettings(@Param("id") id: string) {
    return this.settings.view(id);
  }

  /** Corpo: { campo: valor }. Um segredo omitido fica como está; texto vazio ou null apaga (se não for obrigatório). */
  @Audit("extension.settings_updated", { target: "extension", recordedByService: true })
  @Patch(":id/settings")
  updateSettings(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: { userId: string }) {
    return this.settings.update(id, body, user.userId);
  }
}
