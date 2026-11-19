import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteRoles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { AgendaService } from "./agenda.service";
import { QueryAgendaDto } from "./agenda.dto";

/**
 * Agenda (Fase 2d): só leitura, para todos os utilizadores com sessão (as tarefas e as leads já são visíveis a todos).
 * Não tem escrita; o `@WriteRoles` fica para uma rota de escrita futura não nascer aberta.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...ADMIN_ONLY)
@Controller("agenda")
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get()
  find(@Query() query: QueryAgendaDto) {
    return this.agenda.find(query);
  }
}
