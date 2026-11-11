import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { AutomationsService } from "./automations.service";
import { CreateAutomationRuleDto } from "./dto/create-automation-rule.dto";
import { UpdateAutomationRuleDto } from "./dto/update-automation-rule.dto";

@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("automations")
@Roles(...WRITE_ACCESS.adminOnly)
@Controller("automation-rules")
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get()
  findAll() {
    return this.automationsService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.automationsService.findOne(id);
  }

  @Audit("automation.created", { target: "automation_rule", fields: ["name", "active", "triggerType", "actionType"] })
  @Post()
  create(@Body() dto: CreateAutomationRuleDto) {
    return this.automationsService.create(dto);
  }

  @Audit("automation.updated", { target: "automation_rule", fields: ["name", "active", "triggerType", "actionType"] })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateAutomationRuleDto) {
    return this.automationsService.update(id, dto);
  }

  @Audit("automation.deleted", { target: "automation_rule" })
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.automationsService.remove(id);
  }
}
