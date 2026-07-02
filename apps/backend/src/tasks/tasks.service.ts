import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { QueryTasksDto } from "./dto/query-tasks.dto";

const TASK_INCLUDE = {
  assignee: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, title: true } },
  reminders: { orderBy: { remindAt: "asc" as const } },
};

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryTasksDto) {
    const where: Prisma.TaskWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.from || query.to) {
      where.dueDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    return this.prisma.task.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      include: TASK_INCLUDE,
    });
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({ where: { id }, include: TASK_INCLUDE });
    if (!task) throw new NotFoundException("Tarefa não encontrada");
    return task;
  }

  create(dto: CreateTaskDto, creatorId: string) {
    const { reminders, ...rest } = dto;
    return this.prisma.task.create({
      data: {
        ...rest,
        assigneeId: dto.assigneeId ?? creatorId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        reminders: reminders
          ? { create: reminders.map((r) => ({ remindAt: new Date(r.remindAt), message: r.message })) }
          : undefined,
      },
      include: TASK_INCLUDE,
    });
  }

  async update(id: string, dto: UpdateTaskDto) {
    await this.ensureExists(id);
    const { reminders, ...rest } = dto;

    return this.prisma.task.update({
      where: { id },
      data: {
        ...rest,
        dueDate: dto.dueDate !== undefined ? (dto.dueDate ? new Date(dto.dueDate) : null) : undefined,
        reminders:
          reminders !== undefined
            ? {
                deleteMany: {},
                create: reminders.map((r) => ({ remindAt: new Date(r.remindAt), message: r.message })),
              }
            : undefined,
      },
      include: TASK_INCLUDE,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.task.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.task.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Tarefa não encontrada");
  }
}
