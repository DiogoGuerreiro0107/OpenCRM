import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles, WriteRoles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { SetPasswordDto } from "./dto/set-password.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...WRITE_ACCESS.adminOnly)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Resumo dos utilizadores ATIVOS, para dropdowns — aberto a todos os papéis. */
  @Get()
  findAll() {
    return this.usersService.findAllSummary();
  }

  /** Lista completa (inclui desativados) para a página de gestão — só Administrador. */
  @Roles(...WRITE_ACCESS.adminOnly)
  @Get("manage")
  findAllManaged() {
    return this.usersService.findAllManaged();
  }

  @Audit("user.created", { target: "user", fields: ["name", "email", "role"] })
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }

  @Audit("user.updated", { target: "user", fields: ["name", "email", "role", "active"] })
  @Patch(":id")
  update(@CurrentUser() user: { userId: string }, @Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateUser(user.userId, id, dto);
  }

  @Audit("user.password_set_by_admin", { target: "user" })
  @Post(":id/password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPassword(@Param("id") id: string, @Body() dto: SetPasswordDto) {
    await this.usersService.setPasswordByAdmin(id, dto.newPassword);
  }
}
