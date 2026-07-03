import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTimelineEventDto } from "./dto/create-timeline-event.dto";
import { UpdateTimelineEventDto } from "./dto/update-timeline-event.dto";
import { QueryTimelineDto } from "./dto/query-timeline.dto";

const USER_SELECT = { user: { select: { id: true, name: true } } } as const;

@Injectable()
export class TimelineService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryTimelineDto) {
    return this.prisma.timelineEvent.findMany({
      where: { entityType: query.entityType, entityId: query.entityId },
      orderBy: { createdAt: "desc" },
      include: USER_SELECT,
    });
  }

  create(dto: CreateTimelineEventDto, userId: string) {
    return this.prisma.timelineEvent.create({
      data: { ...dto, userId },
      include: USER_SELECT,
    });
  }

  async update(id: string, dto: UpdateTimelineEventDto) {
    const event = await this.ensureEditable(id);
    return this.prisma.timelineEvent.update({
      where: { id: event.id },
      data: dto,
      include: USER_SELECT,
    });
  }

  async remove(id: string) {
    const event = await this.ensureEditable(id);
    await this.prisma.timelineEvent.delete({ where: { id: event.id } });
  }

  private async ensureEditable(id: string) {
    const event = await this.prisma.timelineEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException("Evento não encontrado");
    if (event.type === "SYSTEM") {
      throw new ForbiddenException("Eventos gerados automaticamente pelo sistema não podem ser editados ou eliminados");
    }
    return event;
  }
}
