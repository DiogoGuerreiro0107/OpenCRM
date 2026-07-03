import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TimelineService } from "./timeline.service";
import { CreateTimelineEventDto } from "./dto/create-timeline-event.dto";
import { UpdateTimelineEventDto } from "./dto/update-timeline-event.dto";
import { QueryTimelineDto } from "./dto/query-timeline.dto";

@UseGuards(JwtAuthGuard)
@Controller("timeline")
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get()
  findAll(@Query() query: QueryTimelineDto) {
    return this.timelineService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateTimelineEventDto, @CurrentUser() user: { userId: string }) {
    return this.timelineService.create(dto, user.userId);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateTimelineEventDto) {
    return this.timelineService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.timelineService.remove(id);
  }
}
