import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { IsString, Matches } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles, WriteRoles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { ExtensionsService } from "./extensions.service";
import { ExtensionSettingsService } from "./extension-settings.service";
import { InstalledExtensionsService } from "./installed-extensions.service";

class ApproveExtensionDto {
  /** A impressão digital que o Administrador viu e aprova (SHA-256 em hexadecimal). */
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: "checksum tem de ser um SHA-256 em hexadecimal" })
  checksum!: string;
}

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
    private readonly installed: InstalledExtensionsService,
  ) {}

  @Get()
  list() {
    return this.extensions.list();
  }

  // ---- Instaladas da pasta (Fase E1.4) ----

  @Get("installed")
  listInstalled() {
    return this.installed.list();
  }

  /** As desligadas sem ser à mão (disjuntor, erro ao arrancar, ficheiros alterados): aviso dos Administradores. */
  @Get("installed/alerts")
  installedAlerts() {
    return this.installed.alerts();
  }

  @Audit("extension.rescanned", { recordedByService: true })
  @HttpCode(HttpStatus.OK)
  @Post("installed/rescan")
  rescan(@CurrentUser() user: { userId: string }) {
    return this.installed.rescan(user.userId);
  }

  @Audit("extension.approved", { target: "extension", recordedByService: true })
  @HttpCode(HttpStatus.OK)
  @Post("installed/:id/approve")
  approve(@Param("id") id: string, @Body() dto: ApproveExtensionDto, @CurrentUser() user: { userId: string }) {
    return this.installed.approve(id, dto.checksum, user.userId);
  }

  @Audit("extension.enabled", { target: "extension", recordedByService: true })
  @HttpCode(HttpStatus.OK)
  @Post("installed/:id/enable")
  enable(@Param("id") id: string, @CurrentUser() user: { userId: string }) {
    return this.installed.enable(id, user.userId);
  }

  @Audit("extension.disabled", { target: "extension", recordedByService: true })
  @HttpCode(HttpStatus.OK)
  @Post("installed/:id/disable")
  disable(@Param("id") id: string, @CurrentUser() user: { userId: string }) {
    return this.installed.disable(id, user.userId);
  }

  // ---- Definições (E1.3; também das instaladas) ----

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
