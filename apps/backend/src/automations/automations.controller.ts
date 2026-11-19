import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { PageQueryDto } from "../common/pagination";
import { IntersectionType } from "@nestjs/mapped-types";
import { AutomationsService } from "./automations.service";
import { CreateAutomationRuleDto, QueryAutomationRunsDto } from "./dto/create-automation-rule.dto";
import { UpdateAutomationRuleDto } from "./dto/update-automation-rule.dto";

class QueryRunsPageDto extends IntersectionType(PageQueryDto, QueryAutomationRunsDto) {}

/** Automações (Fase 3a): só o Administrador; o módulo «Automações» desligado esconde tudo (404). */
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("automations")
@Roles(...ADMIN_ONLY)
@Controller()
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get("automation-rules")
  findAll() {
    return this.automationsService.findAll();
  }

  // Antes de ":id", para «catalog» não ser lido como um id.
  @Get("automation-rules/catalog")
  catalog() {
    return this.automationsService.catalog();
  }

  @Get("automation-rules/:id")
  findOne(@Param("id") id: string) {
    return this.automationsService.findOne(id);
  }

  @Audit("automation.created", { target: "automation_rule", fields: ["name", "active", "entityType", "trigger", "action"] })
  @Post("automation-rules")
  create(@Body() dto: CreateAutomationRuleDto) {
    return this.automationsService.create(dto);
  }

  @Audit("automation.updated", { target: "automation_rule", fields: ["name", "active", "entityType", "trigger", "action"] })
  @Patch("automation-rules/:id")
  update(@Param("id") id: string, @Body() dto: UpdateAutomationRuleDto) {
    return this.automationsService.update(id, dto);
  }

  @Audit("automation.deleted", { target: "automation_rule" })
  @Delete("automation-rules/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.automationsService.remove(id);
  }

  /** Histórico de execuções (o que correu, o que foi ignorado e porquê, falhas). */
  @Get("automation-runs")
  runs(@Query() query: QueryRunsPageDto) {
    return this.automationsService.findRuns(query);
  }
}
