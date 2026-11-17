import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { Roles, WriteArea, WriteRoles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { ZadarmaService } from "./zadarma.service";
import { SaveZadarmaAccountDto } from "./dto/save-zadarma-account.dto";
import { MakeCallDto } from "./dto/make-call.dto";
import { QueryCallRecordsDto } from "./dto/query-call-records.dto";

@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("zadarma")
@WriteRoles(...ADMIN_ONLY)
@Controller("zadarma")
export class ZadarmaController {
  constructor(private readonly zadarmaService: ZadarmaService) {}

  @Roles(...ADMIN_ONLY)
  @Get("account")
  getAccount() {
    return this.zadarmaService.getAccount();
  }

  @Audit("zadarma.account_saved", { target: "zadarma_account", fields: ["callerExtension", "active"], presence: { credenciais: ["apiKey", "apiSecret"] } })
  @Post("account")
  saveAccount(@Body() dto: SaveZadarmaAccountDto) {
    return this.zadarmaService.saveAccount(dto);
  }

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
