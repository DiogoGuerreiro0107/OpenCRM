import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { WriteArea, WriteRoles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { LeadsService } from "./leads.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { QueryLeadPageDto } from "./dto/query-lead-page.dto";
import { LeadSettingsDto } from "./dto/lead-settings.dto";

@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("leads")
@WriteArea("leads")
@Controller("leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  /** Listagem paginada por cursor, com filtros e pesquisa (Fase 1b). Substituiu a lista sem paginação no 1c. */
  @Get("page")
  page(@Query() query: QueryLeadPageDto) {
    return this.leadsService.page(query);
  }

  /** Contagens por estado para os separadores (mesmos filtros da lista, exceto o estado). */
  @Get("counts")
  counts(@Query() query: QueryLeadPageDto) {
    return this.leadsService.counts(query);
  }

  /** Modo do módulo (empresa, pessoa ou ambos): todos leem (a interface precisa dele para criar). */
  @Get("settings")
  settings() {
    return { mode: this.leadsService.mode() };
  }

  /** Mudar o modo é configuração: só o Administrador, auditado. */
  @Audit("lead_settings.updated", { target: "module", fields: ["mode"] })
  @WriteRoles(...ADMIN_ONLY)
  @Patch("settings")
  updateSettings(@Body() dto: LeadSettingsDto) {
    return this.leadsService.setMode(dto.mode);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.leadsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateLeadDto, @CurrentUser() user: { userId: string }) {
    return this.leadsService.create(dto, user.userId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateLeadDto, @CurrentUser() user: { userId: string }) {
    return this.leadsService.update(id, dto, user.userId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.leadsService.remove(id);
  }

  @Post(":id/convert")
  convert(@Param("id") id: string, @CurrentUser() user: { userId: string }) {
    return this.leadsService.convert(id, user.userId);
  }
}
