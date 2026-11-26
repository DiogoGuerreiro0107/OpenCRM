import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { IsBoolean } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles, WriteRoles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { JobsService } from "./jobs.service";

class SetJobEnabledDto {
  @IsBoolean()
  enabled!: boolean;
}

/** Tarefas agendadas (Fase E1.2): só o Administrador vê e mexe. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ADMIN_ONLY)
@WriteRoles(...ADMIN_ONLY)
@Controller("jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list() {
    return this.jobs.list();
  }

  /** As tarefas em pausa (aviso no topo da aplicação). */
  @Get("alerts")
  alerts() {
    return this.jobs.alerts();
  }

  @Get(":id/runs")
  runs(@Param("id") id: string) {
    return this.jobs.runs(id);
  }

  @Audit("job.run", { target: "job" })
  @HttpCode(HttpStatus.OK)
  @Post(":id/run")
  run(@Param("id") id: string, @CurrentUser() user: { userId: string }) {
    return this.jobs.runNow(id, user.userId);
  }

  @Audit("job.toggled", { target: "job", fields: ["enabled"] })
  @Patch(":id")
  setEnabled(@Param("id") id: string, @Body() dto: SetJobEnabledDto) {
    return this.jobs.setEnabled(id, dto.enabled);
  }

  @Audit("job.resumed", { target: "job" })
  @HttpCode(HttpStatus.OK)
  @Post(":id/resume")
  resume(@Param("id") id: string) {
    return this.jobs.resume(id);
  }
}
