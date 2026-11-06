import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles, WriteRoles } from "../auth/decorators/roles.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { ZadarmaService } from "./zadarma.service";
import { SaveZadarmaAccountDto } from "./dto/save-zadarma-account.dto";
import { MakeCallDto } from "./dto/make-call.dto";
import { QueryCallRecordsDto } from "./dto/query-call-records.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...WRITE_ACCESS.adminOnly)
@Controller("zadarma")
export class ZadarmaController {
  constructor(private readonly zadarmaService: ZadarmaService) {}

  @Roles(...WRITE_ACCESS.adminOnly)
  @Get("account")
  getAccount() {
    return this.zadarmaService.getAccount();
  }

  @Post("account")
  saveAccount(@Body() dto: SaveZadarmaAccountDto) {
    return this.zadarmaService.saveAccount(dto);
  }

  @WriteRoles(...WRITE_ACCESS.makeCall)
  @Post("call")
  makeCall(@Body() dto: MakeCallDto) {
    return this.zadarmaService.makeCall(dto);
  }

  @Get("calls")
  listCalls(@Query() query: QueryCallRecordsDto) {
    return this.zadarmaService.listCallRecords(query);
  }
}
