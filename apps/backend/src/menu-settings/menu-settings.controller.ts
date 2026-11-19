import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteRoles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { MenuSettingsService } from "./menu-settings.service";
import { UpdateMenuSettingsDto } from "./menu-settings.dto";

/** Menu principal configurável (Fase 2c, decisão D5): todos leem (o menu de cada um usa-o); só o Administrador grava. */
@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...ADMIN_ONLY)
@Controller("menu-settings")
export class MenuSettingsController {
  constructor(private readonly menu: MenuSettingsService) {}

  @Get()
  get() {
    return this.menu.get();
  }

  @Audit("menu_settings.updated", { target: "menu_settings" })
  @Put()
  update(@Body() dto: UpdateMenuSettingsDto) {
    return this.menu.update(dto.entries);
  }
}
