import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { IsBoolean } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles, WriteRoles } from "../auth/decorators/roles.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { ModulesService } from "./modules.service";

class SetModuleEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...WRITE_ACCESS.adminOnly)
@Controller("modules")
export class ModulesController {
  constructor(private readonly modules: ModulesService) {}

  /** Que módulos estão ativos — qualquer utilizador autenticado (o menu precisa disto). */
  @Get()
  enabled() {
    return { enabled: this.modules.enabledIds() };
  }

  /** Lista completa com dependências, para a página de definições. Só o Administrador. */
  @Roles(...WRITE_ACCESS.adminOnly)
  @Get("manage")
  manage() {
    return this.modules.list();
  }

  @Patch(":id")
  setEnabled(@Param("id") id: string, @Body() dto: SetModuleEnabledDto) {
    return this.modules.setEnabled(id, dto.enabled);
  }
}
