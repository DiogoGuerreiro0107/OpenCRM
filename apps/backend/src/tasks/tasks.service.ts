import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AutomationsService } from "../automations/automations.service";
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly automations: AutomationsService,
  ) {}

  findAll(query: QueryTasksDto) {
    const where: Prisma.TaskWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.priority) where.priority = query.priority;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.companyId) where.companyId = query.companyId;
    if (query.contactId) where.contactId = query.contactId;
    if (query.from || query.to) {
      where.dueDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    if (query.overdue === "true" || query.dueToday === "true") {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfTomorrow = new Date(startOfToday);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

      where.status = { not: "DONE" };
      where.dueDate = query.overdue === "true" ? { lt: startOfToday } : { gte: startOfToday, lt: startOfTomorrow };
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

  async update(id: string, dto: UpdateTaskDto, actingUserId: string) {
    const existing = await this.prisma.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Tarefa não encontrada");
    const { reminders, ...rest } = dto;

    const task = await this.prisma.task.update({
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

    if (dto.status === "DONE" && existing.status !== "DONE") {
      const description = `Tarefa concluída: "${task.title}".`;
      const events: { entityType: "CONTACT" | "COMPANY" | "DEAL" | "LEAD" | "TASK"; entityId: string }[] = [
        { entityType: "TASK", entityId: task.id },
      ];
      if (task.contactId) events.push({ entityType: "CONTACT", entityId: task.contactId });
      if (task.companyId) events.push({ entityType: "COMPANY", entityId: task.companyId });
      if (task.dealId) events.push({ entityType: "DEAL", entityId: task.dealId });
      if (task.leadId) events.push({ entityType: "LEAD", entityId: task.leadId });

      await this.prisma.timelineEvent.createMany({
        data: events.map((e) => ({ ...e, type: "SYSTEM", description, userId: actingUserId })),
      });

      if (task.dealId) {
        await this.automations.evaluateTaskCompletedRules(task.dealId);
      }
    }

    return task;
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
