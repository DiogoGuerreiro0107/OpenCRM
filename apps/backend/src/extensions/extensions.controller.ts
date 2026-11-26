import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles, WriteRoles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { ExtensionsService } from "./extensions.service";

/** Extensões (Fase E1.1): só leitura, só o Administrador. Ligar/desligar continua em PATCH /modules/:id. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ONLY)
@WriteRoles(...ADMIN_ONLY)
@Controller("extensions")
export class ExtensionsController {
  constructor(private readonly extensions: ExtensionsService) {}

  @Get()
  list() {
    return this.extensions.list();
  }
}
