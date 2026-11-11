import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { AuditService } from "./audit.service";
import { QueryAuditDto } from "./dto/query-audit.dto";

/** Só o Administrador lê o registo. Não há rotas de escrita: o registo só se acrescenta por dentro da aplicação. */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WRITE_ACCESS.adminOnly)
@Controller("audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@Query() query: QueryAuditDto) {
    return this.audit.list(query);
  }
}
