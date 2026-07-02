import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TimelineService } from "./timeline.service";
import { CreateTimelineEventDto } from "./dto/create-timeline-event.dto";
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
}
