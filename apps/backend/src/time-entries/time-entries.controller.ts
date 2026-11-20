import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteArea } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Audit } from "../audit/audit.decorator";
import { Actor, TimeEntriesService } from "./time-entries.service";
import {
  CreateTimeEntryDto,
  DeleteTimeEntryDto,
  QueryTimeEntriesDto,
  StartTimerDto,
  StopTimerDto,
  TimeSummaryQueryDto,
  UpdateTimeEntryDto,
} from "./dto/time-entry.dto";

/**
 * Registo de tempo (Fase 4b): as mesmas permissões das tarefas (área «trabalho do dia-a-dia»); ler é para todos. Cada
 * pessoa altera os seus registos; o Administrador, os de todos.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@WriteArea("dailyWork")
@Controller("time-entries")
export class TimeEntriesController {
  constructor(private readonly timeEntries: TimeEntriesService) {}

  @Get()
  findPage(@Query() query: QueryTimeEntriesDto) {
    return this.timeEntries.findPage(query);
  }

  @Get("active")
  active(@CurrentUser() user: Actor) {
    return this.timeEntries.active(user.userId);
  }

  @Get("summary")
  summary(@Query() query: TimeSummaryQueryDto) {
    return this.timeEntries.summary(query.workItemId);
  }

  @Post("start")
  start(@Body() dto: StartTimerDto, @CurrentUser() user: Actor) {
    return this.timeEntries.start(dto, user.userId);
  }

  @Post("stop")
  @HttpCode(HttpStatus.OK)
  stop(@Body() dto: StopTimerDto, @CurrentUser() user: Actor) {
    return this.timeEntries.stop(dto, user.userId);
  }

  @Post()
  create(@Body() dto: CreateTimeEntryDto, @CurrentUser() user: Actor) {
    return this.timeEntries.create(dto, user.userId);
  }

  @Patch(":id")
  @Audit("time_entry.updated", { target: "time_entry", fields: ["startedAt", "endedAt", "billable", "reason"] })
  update(@Param("id") id: string, @Body() dto: UpdateTimeEntryDto, @CurrentUser() user: Actor) {
    return this.timeEntries.update(id, dto, user);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audit("time_entry.deleted", { target: "time_entry", fields: ["reason"] })
  remove(@Param("id") id: string, @Body() dto: DeleteTimeEntryDto, @CurrentUser() user: Actor) {
    return this.timeEntries.remove(id, dto, user);
  }
}
