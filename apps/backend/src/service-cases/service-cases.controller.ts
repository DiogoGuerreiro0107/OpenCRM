import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteArea } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { ServiceCasesService } from "./service-cases.service";
import { ServicePartsService } from "./service-parts.service";
import { ServiceIndicatorsService } from "./service-indicators.service";
import { CreateServicePartDto, ServiceIndicatorsQueryDto, UpdateServicePartDto } from "./dto/service-part.dto";
import { CreateServiceCaseDto, QueryServiceCasesDto, UpdateServiceCaseDto } from "./dto/service-case.dto";

/** Assistências (módulo assistencias, Fase 4a): as mesmas permissões das tarefas; ler é para todos. */
@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("assistencias")
@WriteArea("dailyWork")
@Controller("service-cases")
export class ServiceCasesController {
  constructor(
    private readonly serviceCases: ServiceCasesService,
    private readonly parts: ServicePartsService,
    private readonly indicatorsService: ServiceIndicatorsService,
  ) {}

  @Get()
  findPage(@Query() query: QueryServiceCasesDto) {
    return this.serviceCases.findPage(query);
  }

  /** Indicadores do módulo (Fase 4c). Antes de `:id`, senão «indicators» seria lido como um id. */
  @Get("indicators")
  indicators(@Query() query: ServiceIndicatorsQueryDto) {
    return this.indicatorsService.indicators(query);
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

  /** Peças usadas (Fase 4c). */
  @Get(":id/parts")
  listParts(@Param("id") id: string) {
    return this.parts.list(id);
  }

  @Post(":id/parts")
  createPart(@Param("id") id: string, @Body() dto: CreateServicePartDto, @CurrentUser() user: { userId: string }) {
    return this.parts.create(id, dto, user.userId);
  }

  @Patch(":id/parts/:partId")
  updatePart(@Param("id") id: string, @Param("partId") partId: string, @Body() dto: UpdateServicePartDto, @CurrentUser() user: { userId: string }) {
    return this.parts.update(id, partId, dto, user.userId);
  }

  @Delete(":id/parts/:partId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removePart(@Param("id") id: string, @Param("partId") partId: string, @CurrentUser() user: { userId: string }) {
    return this.parts.remove(id, partId, user.userId);
  }
}
