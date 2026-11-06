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
import { WriteRoles } from "../auth/decorators/roles.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { DealsService } from "./deals.service";
import { CreateDealDto } from "./dto/create-deal.dto";
import { UpdateDealDto } from "./dto/update-deal.dto";
import { MoveDealDto } from "./dto/move-deal.dto";

@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("deals")
@WriteRoles(...WRITE_ACCESS.deals)
@Controller("deals")
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Get()
  findAll(@Query("pipelineId") pipelineId: string) {
    return this.dealsService.findAllByPipeline(pipelineId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.dealsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateDealDto, @CurrentUser() user: { userId: string }) {
    return this.dealsService.create(dto, user.userId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateDealDto) {
    return this.dealsService.update(id, dto);
  }

  @Patch(":id/move")
  move(@Param("id") id: string, @Body() dto: MoveDealDto) {
    return this.dealsService.move(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.dealsService.remove(id);
  }
}
