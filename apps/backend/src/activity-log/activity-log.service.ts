import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateActivityLogDto } from "./dto/create-activity-log.dto";

@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateActivityLogDto, authorId: string) {
    if (!dto.contactId && !dto.companyId) {
      throw new BadRequestException("A atividade tem de estar associada a um contacto ou empresa");
    }

    return this.prisma.activityLog.create({
      data: { ...dto, authorId },
      include: { author: { select: { id: true, name: true } } },
    });
  }
}
