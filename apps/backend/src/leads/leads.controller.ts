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
import { LeadsService } from "./leads.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { QueryLeadsDto } from "./dto/query-leads.dto";

@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("leads")
@WriteRoles(...WRITE_ACCESS.leads)
@Controller("leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  findAll(@Query() query: QueryLeadsDto) {
    return this.leadsService.findAll(query);
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
  update(@Param("id") id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.update(id, dto);
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
