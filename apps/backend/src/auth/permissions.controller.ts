import { Body, Controller, Delete, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { ArrayUnique, IsArray, IsEnum } from "class-validator";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { RolesGuard } from "./guards/roles.guard";
import { Roles, WriteRoles } from "./decorators/roles.decorator";
import { CurrentUser } from "./decorators/current-user.decorator";
import { ADMIN_ONLY } from "./permissions";
import { PermissionsService } from "./permissions.service";
import { Audit } from "../audit/audit.decorator";

class SetPermissionDto {
  @IsArray()
  @ArrayUnique()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}

/**
 * Permissões de escrita configuráveis (Fase 0d). Ler as PRÓPRIAS permissões: qualquer utilizador autenticado (o
 * frontend usa-as para mostrar/esconder botões). Ver e alterar a matriz: só o Administrador, auditado.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...ADMIN_ONLY)
@Controller()
export class PermissionsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get("me/permissions")
  mine(@CurrentUser() user: { role: Role }) {
    return { role: user.role, writeAreas: this.permissions.writeAreasFor(user.role) };
  }

  @Roles(...ADMIN_ONLY)
  @Get("permissions")
  list() {
    return this.permissions.list();
  }

  @Audit("permission.updated", { target: "permission_area", param: "area", fields: ["roles"] })
  @Patch("permissions/:area")
  set(@Param("area") area: string, @Body() dto: SetPermissionDto) {
    return this.permissions.set(area, dto.roles);
  }

  @Audit("permission.reset", { target: "permission_area", param: "area" })
  @Delete("permissions/:area")
  reset(@Param("area") area: string) {
    return this.permissions.reset(area);
  }
}
