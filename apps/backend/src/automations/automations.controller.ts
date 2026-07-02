import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AutomationsService } from "./automations.service";
import { CreateAutomationRuleDto } from "./dto/create-automation-rule.dto";
import { UpdateAutomationRuleDto } from "./dto/update-automation-rule.dto";

@UseGuards(JwtAuthGuard)
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

  @Post()
  create(@Body() dto: CreateAutomationRuleDto) {
    return this.automationsService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateAutomationRuleDto) {
    return this.automationsService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.automationsService.remove(id);
  }
}
