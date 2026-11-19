import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AutomationsService } from "../automations/automations.service";
import { WorkItemTypesService } from "../work-item-types/work-item-types.service";
import { OPEN_WORK_ITEM_STATUSES, isOpenStatus } from "./work-item-status";
import { resolveWorkItemStep } from "./work-item-steps";
import { DEFAULT_WORK_ITEM_TYPE } from "../work-item-types/system-types";
import { CreateTaskDto } from "./dto/create-task.dto";
import { UpdateTaskDto } from "./dto/update-task.dto";
import { QueryTaskBoardDto, QueryTaskCalendarDto, QueryTasksDto, TaskFiltersDto } from "./dto/query-tasks.dto";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import { foldSearch } from "../common/search-text";
import { isTimeZone, isUnknownTimeZoneError } from "../common/time-zone";

const TASK_INCLUDE = {
  type: { select: { id: true, name: true, icon: true, color: true } },
  step: { select: { id: true, name: true, category: true } },
  assignee: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
  deal: { select: { id: true, title: true } },
  reminders: { orderBy: { remindAt: "asc" as const } },
};

/**
 * Chave da lista de tarefas: prazo (as sem prazo no fim — `dueSort` é o prazo ou 9999-12-31, mantido por trigger),
 * depois as criadas mais recentemente, depois id.
 */
const TASK_KEY: KeyField[] = [
  { field: "dueSort", dir: "asc", kind: "date" },
  { field: "createdAt", dir: "desc", kind: "date" },
  { field: "id", dir: "desc", kind: "string" },
];
const NO_DUE_DATE = new Date("9999-12-31T00:00:00.000Z");
export const CALENDAR_MAX_DAYS = 62;
/** Tarefas por dia que a grelha do mês mostra (o resto aparece como «+N»). */
export const CALENDAR_PER_DAY = 3;

/** Horário marcado de uma escrita: `undefined` = não mexer, `null` = limpar. */
function toDate(value: string | null | undefined) {
  return value === undefined ? undefined : value ? new Date(value) : null;
}

/** O fim exige início e não pode ser antes dele (a base de dados confirma com uma restrição CHECK). */
function assertSchedule(start: Date | null | undefined, end: Date | null | undefined) {
  if (end && !start) throw new BadRequestException("Indica o início do horário marcado");
  if (start && end && end < start) throw new BadRequestException("O fim do horário marcado não pode ser antes do início");
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automations: AutomationsService,
    private readonly types: WorkItemTypesService,
  ) {}

  /** Filtros comuns à lista e ao quadro por passos. */
  private filtersWhere(query: TaskFiltersDto): Prisma.WorkItemWhereInput {
    const where: Prisma.WorkItemWhereInput = {};
    const term = query.search ? foldSearch(query.search.trim()) : "";
    if (term) where.searchText = { contains: term };
    if (query.status) where.status = query.status;
    if (query.typeId) where.typeId = query.typeId;
    if (query.stepId) where.stepId = query.stepId;
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

      where.status = { in: OPEN_WORK_ITEM_STATUSES };
      where.dueDate = query.overdue === "true" ? { lt: startOfToday } : { gte: startOfToday, lt: startOfTomorrow };
    }
    return where;
  }

  /** Página da lista de tarefas (ou de uma coluna do quadro, com `stepId`). */
  findAll(query: QueryTasksDto) {
    const where = this.filtersWhere(query);
    return readPage(
      TASK_KEY,
      query,
      (after, take) =>
        this.prisma.workItem.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(TASK_KEY), take, include: TASK_INCLUDE }),
      // dueSort não sai nas respostas (coluna interna): calcula-se do prazo, como no trigger.
      (task) => [task.dueDate ?? NO_DUE_DATE, task.createdAt, task.id],
    );
  }

  /**
   * Calendário: no intervalo visível, as primeiras CALENDAR_PER_DAY tarefas de cada dia e quantas há em cada dia. O dia
   * de uma tarefa é o do seu momento na agenda (`agendaAt`: início marcado, senão o prazo; Fase 2d).
   * A resposta tem no máximo dias × CALENDAR_PER_DAY tarefas, seja qual for o volume (medido: 4 451 tarefas em 6
   * semanas demoravam 434 ms a devolver, para a grelha mostrar 3 por dia).
   */
  async findCalendar(query: QueryTaskCalendarDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days < 0 || days > CALENDAR_MAX_DAYS) {
      throw new BadRequestException(`O intervalo do calendário tem de ter entre 0 e ${CALENDAR_MAX_DAYS} dias`);
    }
    const tz = query.tz ?? "UTC";
    if (!isTimeZone(tz)) throw new BadRequestException("Fuso horário desconhecido");
    const assignee = query.assigneeId ? Prisma.sql`AND t."assigneeId" = ${query.assigneeId}` : Prisma.empty;
    const type = query.typeId ? Prisma.sql`AND t."typeId" = ${query.typeId}` : Prisma.empty;
    // O prazo está guardado em UTC; o dia conta-se no fuso do browser, como a grelha.
    const rows = await this.prisma
      .$queryRaw<Array<{ id: string; day: string; n: bigint }>>`
      SELECT id, day, n FROM (
        SELECT t.id, d.day,
          row_number() OVER (PARTITION BY d.day ORDER BY t."agendaAt", t.id) AS rn,
          count(*) OVER (PARTITION BY d.day) AS n
        FROM "WorkItem" t
        CROSS JOIN LATERAL (SELECT to_char((t."agendaAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day) d
        WHERE t."agendaAt" >= ${from} AND t."agendaAt" <= ${to} ${assignee} ${type}
      ) x
      WHERE rn <= ${CALENDAR_PER_DAY}`
      .catch((err: unknown) => {
        // Um nome que o Node conhece e o Postgres não (tzdata diferente): pedido inválido, não erro do servidor.
        if (isUnknownTimeZoneError(err)) throw new BadRequestException("Fuso horário desconhecido");
        throw err;
      });
    const items = await this.prisma.workItem.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      orderBy: [{ agendaAt: "asc" }, { id: "asc" }],
      include: TASK_INCLUDE,
    });
    const countsByDay = Object.fromEntries(rows.map((r) => [r.day, Number(r.n)]));
    return { items, countsByDay };
  }

  /** Quadro de um tipo com passos: quantas tarefas há em cada passo, com os mesmos filtros da lista. */
  async board(query: QueryTaskBoardDto) {
    const grouped = await this.prisma.workItem.groupBy({ by: ["stepId"], where: this.filtersWhere(query), _count: { _all: true } });
    return grouped.filter((g) => g.stepId).map((g) => ({ stepId: g.stepId as string, count: g._count._all }));
  }

  async findOne(id: string) {
    const task = await this.prisma.workItem.findUnique({ where: { id }, include: TASK_INCLUDE });
    if (!task) throw new NotFoundException("Tarefa não encontrada");
    return task;
  }

  async create(dto: CreateTaskDto, creatorId: string) {
    if (dto.typeId) await this.types.assertUsable(dto.typeId);
    const { reminders, scheduledStart, scheduledEnd, ...rest } = dto;
    const schedule = { scheduledStart: toDate(scheduledStart), scheduledEnd: toDate(scheduledEnd) };
    assertSchedule(schedule.scheduledStart, schedule.scheduledEnd);
    // Num tipo com passos, o passo decide o estado (docs/plano-fase-2-itens-de-trabalho.md, pacote 2b).
    const step = await resolveWorkItemStep(this.prisma, { typeId: dto.typeId ?? DEFAULT_WORK_ITEM_TYPE, stepId: dto.stepId, status: dto.status });
    return this.prisma.workItem.create({
      data: {
        ...rest,
        ...schedule,
        stepId: step.stepId,
        status: step.status,
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
    const existing = await this.prisma.workItem.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Tarefa não encontrada");
    if (dto.typeId) await this.types.assertUsable(dto.typeId, existing.typeId);
    const { reminders, scheduledStart, scheduledEnd, ...rest } = dto;
    const schedule = { scheduledStart: toDate(scheduledStart), scheduledEnd: toDate(scheduledEnd) };
    // Valida o horário que fica (o que vem no pedido por cima do que já existe).
    assertSchedule(
      schedule.scheduledStart === undefined ? existing.scheduledStart : schedule.scheduledStart,
      schedule.scheduledEnd === undefined ? existing.scheduledEnd : schedule.scheduledEnd,
    );

    // Passo e estado só se resolvem quando algum deles (ou o tipo) vem no pedido; editar o título não mexe no passo.
    const typeId = dto.typeId ?? existing.typeId;
    const touchesStep = typeId !== existing.typeId || dto.stepId !== undefined || dto.status !== undefined;
    const step = touchesStep
      ? await resolveWorkItemStep(this.prisma, { typeId, stepId: dto.stepId, status: dto.status, currentStepId: existing.stepId }, existing.status)
      : null;
    const nextStatus = step?.status ?? existing.status;

    const task = await this.prisma.workItem.update({
      where: { id },
      data: {
        ...rest,
        ...schedule,
        ...(step ? { stepId: step.stepId, status: nextStatus } : {}),
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

    // Fechar (concluir ou cancelar) regista-se na timeline da tarefa e dos registos ligados.
    const closedAs = nextStatus !== existing.status && !isOpenStatus(nextStatus) ? nextStatus : null;
    if (closedAs) {
      const description = `Tarefa ${closedAs === "DONE" ? "concluída" : "cancelada"}: "${task.title}".`;
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

      // A regra «tarefas do negócio concluídas» olha para as que ficam em aberto: cancelar a última também conta.
      if (task.dealId && isOpenStatus(existing.status)) {
        await this.automations.dispatch({ entityType: "DEAL", entityId: task.dealId, trigger: "ALL_TASKS_CLOSED" });
      }
    }

    return task;
  }

  async remove(id: string) {
    await this.ensureExists(id);
    // Os valores dos campos personalizados não têm chave estrangeira (polimórficos): apagam-se juntamente.
    await this.prisma.$transaction([
      this.prisma.customFieldValue.deleteMany({ where: { entityType: "WORK_ITEM", entityId: id } }),
      this.prisma.workItem.delete({ where: { id } }),
    ]);
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.workItem.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Tarefa não encontrada");
  }
}
