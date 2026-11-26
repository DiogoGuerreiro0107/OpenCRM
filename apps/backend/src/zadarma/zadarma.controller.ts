import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { WriteArea, WriteRoles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { ZadarmaService } from "./zadarma.service";
import { MakeCallDto } from "./dto/make-call.dto";
import { QueryCallRecordsDto } from "./dto/query-call-records.dto";

@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("zadarma")
@WriteRoles(...ADMIN_ONLY)
/** Telefonia (Zadarma). As credenciais são definições da extensão (Fase E1.3): GET/PATCH /extensions/zadarma/settings. */
@Controller("zadarma")
export class ZadarmaController {
  constructor(private readonly zadarmaService: ZadarmaService) {}

  @WriteArea("makeCall")
  @Post("call")
  makeCall(@Body() dto: MakeCallDto) {
    return this.zadarmaService.makeCall(dto);
  }

  @Get("calls")
  listCalls(@Query() query: QueryCallRecordsDto) {
    return this.zadarmaService.listCallRecords(query);
  }
}
