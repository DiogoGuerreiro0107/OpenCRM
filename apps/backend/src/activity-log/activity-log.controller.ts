import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ActivityLogService } from "./activity-log.service";
import { CreateActivityLogDto } from "./dto/create-activity-log.dto";

@UseGuards(JwtAuthGuard)
@Controller("activity-log")
export class ActivityLogController {
  constructor(private readonly activityLogService: ActivityLogService) {}

  @Post()
  create(@Body() dto: CreateActivityLogDto, @CurrentUser() user: { userId: string }) {
    return this.activityLogService.create(dto, user.userId);
  }
}
