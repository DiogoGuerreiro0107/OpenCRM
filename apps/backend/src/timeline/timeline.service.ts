import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTimelineEventDto } from "./dto/create-timeline-event.dto";
import { QueryTimelineDto } from "./dto/query-timeline.dto";

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryTimelineDto) {
    return this.prisma.timelineEvent.findMany({
      where: { entityType: query.entityType, entityId: query.entityId },
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  create(dto: CreateTimelineEventDto, userId: string) {
    return this.prisma.timelineEvent.create({
      data: { ...dto, userId },
      include: { user: { select: { id: true, name: true } } },
    });
  }
}
