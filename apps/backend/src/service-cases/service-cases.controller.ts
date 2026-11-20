import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteArea } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { ServiceCasesService } from "./service-cases.service";
import { CreateServiceCaseDto, QueryServiceCasesDto, UpdateServiceCaseDto } from "./dto/service-case.dto";

/** Assistências (módulo assistencias, Fase 4a): as mesmas permissões das tarefas; ler é para todos. */
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("assistencias")
@WriteArea("dailyWork")
@Controller("service-cases")
export class ServiceCasesController {
  constructor(private readonly serviceCases: ServiceCasesService) {}

  @Get()
  findPage(@Query() query: QueryServiceCasesDto) {
    return this.serviceCases.findPage(query);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.serviceCases.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateServiceCaseDto, @CurrentUser() user: { userId: string }) {
    return this.serviceCases.create(dto, user.userId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateServiceCaseDto, @CurrentUser() user: { userId: string }) {
    return this.serviceCases.update(id, dto, user.userId);
  }
}
