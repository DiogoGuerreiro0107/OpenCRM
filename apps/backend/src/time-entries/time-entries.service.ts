import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AutomationsService } from "../automations/automations.service";
import { newChain } from "../automations/registry/engine";
import { isOpenStatus } from "../tasks/work-item-status";
import { serviceCode } from "../service-cases/service-cases.service";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import {
  durationSeconds,
  exceedsMaxDuration,
  formatDuration,
  formatRange,
  isForgotten,
  MAX_ENTRY_HOURS,
} from "./time-entry-rules";
import { CreateTimeEntryDto, DeleteTimeEntryDto, QueryTimeEntriesDto, StartTimerDto, StopTimerDto, UpdateTimeEntryDto } from "./dto/time-entry.dto";

/** Quem faz o pedido. */
export interface Actor {
  userId: string;
  role: Role;
}

const INCLUDE = {
  user: { select: { id: true, name: true } },
  editedBy: { select: { id: true, name: true } },
} as const;

const WORK_ITEM_SUMMARY = { select: { id: true, title: true, typeId: true, status: true, serviceCase: { select: { number: true } } } } as const;

/** Mais recentes primeiro. */
const LIST_KEY: KeyField[] = [
  { field: "startedAt", dir: "desc", kind: "date" },
  { field: "id", dir: "desc", kind: "string" },
];

/** Tolerância para relógios ligeiramente adiantados no browser. */
const CLOCK_SKEW_MS = 60_000;

type EntryRow = Prisma.TimeEntryGetPayload<{ include: typeof INCLUDE }>;

/**
 * Registo de tempo nos itens de trabalho (Fase 4b, docs/plano-fase-4-assistencias.md). O servidor é a fonte de
 * verdade: «iniciar» grava o início e «parar» o fim. Um só cronómetro a correr por pessoa (garantido pela base de dados);
 * os registos de uma pessoa não se sobrepõem; mudar horas ou apagar pede motivo e fica na timeline do item.
 */
@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly automations: AutomationsService,
  ) {}

  private view<T extends { startedAt: Date; endedAt: Date | null; runningUserId?: string | null }>(entry: T, now = new Date()) {
    const { runningUserId: _running, ...rest } = entry;
    return { ...rest, running: entry.endedAt === null, durationSeconds: durationSeconds(entry, now) };
  }

  private workItemView(w: { id: string; title: string; typeId: string; status: string; serviceCase: { number: number } | null }) {
    const { serviceCase, ...rest } = w;
    return { ...rest, serviceCaseCode: serviceCase ? serviceCode(serviceCase.number) : null };
  }

  /** O meu cronómetro a correr (ou nenhum), com a hora do servidor para o contador do ecrã. */
  async active(userId: string) {
    const now = new Date();
    const entry = await this.prisma.timeEntry.findUnique({ where: { runningUserId: userId }, include: { ...INCLUDE, workItem: WORK_ITEM_SUMMARY } });
    if (!entry) return { entry: null, serverNow: now };
    const { workItem, ...rest } = entry;
    return { entry: { ...this.view(rest, now), workItem: this.workItemView(workItem), forgotten: isForgotten(entry, now) }, serverNow: now };
  }

  /** Inicia o cronómetro no item; se já corria noutro, para esse primeiro (na mesma transação). */
  async start(dto: StartTimerDto, userId: string) {
    const item = await this.prisma.workItem.findUnique({ where: { id: dto.workItemId }, select: { status: true } });
    if (!item) throw new NotFoundException("Tarefa não encontrada");
    if (!isOpenStatus(item.status)) throw new BadRequestException("Não se regista tempo numa tarefa concluída ou cancelada");

    const current = await this.prisma.timeEntry.findUnique({ where: { runningUserId: userId }, include: INCLUDE });
    if (current?.workItemId === dto.workItemId) return { entry: this.view(current), stopped: null };

    const now = new Date();
    let stoppedId: string | null = null;
    let entry: EntryRow;
    try {
      entry = await this.prisma.$transaction(async (tx) => {
        if (current) {
          const endedAt = now < current.startedAt ? current.startedAt : now;
          const { count } = await tx.timeEntry.updateMany({ where: { id: current.id, endedAt: null }, data: { endedAt, runningUserId: null } });
          if (count > 0) stoppedId = current.id;
        }
        return tx.timeEntry.create({
          data: { workItemId: dto.workItemId, userId, startedAt: now, runningUserId: userId, note: dto.note?.trim() || null },
          include: INCLUDE,
        });
      });
    } catch (err) {
      // Outro «iniciar» da mesma pessoa ganhou a corrida: a base de dados não deixa haver dois a correr.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("Já tens um cronómetro a correr. Atualiza a página.");
      }
      throw err;
    }

    let stopped = null;
    if (stoppedId && current) {
      await this.timerStopped(current.workItemId, userId);
      const row = await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: stoppedId }, include: { ...INCLUDE, workItem: WORK_ITEM_SUMMARY } });
      const { workItem, ...rest } = row;
      stopped = { ...this.view(rest), workItem: this.workItemView(workItem) };
    }
    return { entry: this.view(entry), stopped };
  }

  /** Para o meu cronómetro. */
  async stop(dto: StopTimerDto, userId: string) {
    const current = await this.prisma.timeEntry.findUnique({ where: { runningUserId: userId } });
    if (!current) throw new NotFoundException("Não tens nenhum cronómetro a correr");
    const now = new Date();
    const note = dto.note?.trim();
    const { count } = await this.prisma.timeEntry.updateMany({
      where: { id: current.id, endedAt: null },
      data: { endedAt: now < current.startedAt ? current.startedAt : now, runningUserId: null, ...(note ? { note } : {}) },
    });
    if (count === 0) throw new NotFoundException("Não tens nenhum cronómetro a correr");
    await this.timerStopped(current.workItemId, userId);
    return this.view(await this.prisma.timeEntry.findUniqueOrThrow({ where: { id: current.id }, include: INCLUDE }));
  }

  /** Gatilho «cronómetro parado» das automações das tarefas. */
  async timerStopped(workItemId: string, actorId: string) {
    await this.automations.dispatch({ entityType: "WORK_ITEM", entityId: workItemId, trigger: "TIMER_STOPPED", actorId }, newChain());
  }

  /** Registo manual (no passado; até 24 h; sem se sobrepor a outro registo da pessoa). */
  async create(dto: CreateTimeEntryDto, userId: string) {
    const item = await this.prisma.workItem.findUnique({ where: { id: dto.workItemId }, select: { id: true } });
    if (!item) throw new NotFoundException("Tarefa não encontrada");
    const startedAt = new Date(dto.startedAt);
    const endedAt = new Date(dto.endedAt);
    this.assertClosedRange(startedAt, endedAt);
    await this.assertNoOverlap(userId, startedAt, endedAt);
    const entry = await this.prisma.timeEntry.create({
      data: { workItemId: dto.workItemId, userId, startedAt, endedAt, manual: true, note: dto.note?.trim() || null, billable: dto.billable ?? true },
      include: INCLUDE,
    });
    return this.view(entry);
  }

  /** Nota e faturável mudam-se livremente; as horas só com motivo (fica no registo, na timeline e na auditoria). */
  async update(id: string, dto: UpdateTimeEntryDto, actor: Actor) {
    const entry = await this.findOwned(id, actor);
    const running = entry.endedAt === null;
    if (running && dto.endedAt !== undefined) throw new BadRequestException("Para parar um cronómetro usa «Parar»");

    const startedAt = dto.startedAt !== undefined ? new Date(dto.startedAt) : entry.startedAt;
    const endedAt = dto.endedAt !== undefined ? new Date(dto.endedAt) : entry.endedAt;
    const timesChanged = startedAt.getTime() !== entry.startedAt.getTime() || endedAt?.getTime() !== entry.endedAt?.getTime();
    const reason = dto.reason?.trim();

    if (timesChanged) {
      if (!reason) throw new BadRequestException("Indica o motivo da alteração das horas");
      if (endedAt) this.assertClosedRange(startedAt, endedAt);
      else if (startedAt.getTime() > Date.now() + CLOCK_SKEW_MS) throw new BadRequestException("O início não pode ser no futuro");
      await this.assertNoOverlap(entry.userId, startedAt, endedAt, entry.id);
    }

    const updated = await this.prisma.timeEntry.update({
      where: { id },
      data: {
        note: dto.note === undefined ? undefined : dto.note?.trim() || null,
        billable: dto.billable,
        ...(timesChanged ? { startedAt, endedAt, editReason: reason, editedAt: new Date(), editedById: actor.userId } : {}),
      },
      include: INCLUDE,
    });
    if (timesChanged) {
      const description = `Tempo acertado (${entry.user.name}): ${formatRange(entry, dto.tz)} → ${formatRange(updated, dto.tz)}. Motivo: ${reason}`;
      await this.prisma.timelineEvent.create({ data: { entityType: "TASK", entityId: entry.workItemId, type: "SYSTEM", description, userId: actor.userId } });
    }
    return this.view(updated);
  }

  /** Apagar pede motivo; fica na timeline do item e na auditoria. */
  async remove(id: string, dto: DeleteTimeEntryDto, actor: Actor) {
    const entry = await this.findOwned(id, actor);
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException("Indica o motivo para apagar o registo de tempo");
    await this.prisma.timeEntry.delete({ where: { id } });
    const description = `Registo de tempo apagado (${entry.user.name}, ${formatRange(entry, dto.tz)}, ${formatDuration(durationSeconds(entry))}). Motivo: ${reason}`;
    await this.prisma.timelineEvent.create({ data: { entityType: "TASK", entityId: entry.workItemId, type: "SYSTEM", description, userId: actor.userId } });
  }

  async findPage(query: QueryTimeEntriesDto) {
    const where: Prisma.TimeEntryWhereInput = {};
    if (query.workItemId) where.workItemId = query.workItemId;
    if (query.userId) where.userId = query.userId;
    if (query.from || query.to) where.startedAt = { gte: query.from ? new Date(query.from) : undefined, lt: query.to ? new Date(query.to) : undefined };
    const now = new Date();
    const page = await readPage(LIST_KEY, query, (after, take) =>
      this.prisma.timeEntry.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(LIST_KEY), take, include: INCLUDE }),
    );
    return { ...page, items: page.items.map((e) => this.view(e, now)) };
  }

  /** Total, faturável e total por pessoa de um item (o que está a correr conta até agora). */
  async summary(workItemId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ userId: string; total: number; billable: number }>>`
      SELECT "userId",
             COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE("endedAt", now()) - "startedAt"))), 0)::float8 AS total,
             COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE("endedAt", now()) - "startedAt"))) FILTER (WHERE "billable"), 0)::float8 AS billable
      FROM "TimeEntry" WHERE "workItemId" = ${workItemId} GROUP BY "userId"`;
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u]));
    const byUser = rows
      .map((r) => ({ user: nameOf.get(r.userId) ?? { id: r.userId, name: "?" }, totalSeconds: Math.round(r.total), billableSeconds: Math.round(r.billable) }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds || a.user.name.localeCompare(b.user.name));
    return {
      totalSeconds: byUser.reduce((sum, u) => sum + u.totalSeconds, 0),
      billableSeconds: byUser.reduce((sum, u) => sum + u.billableSeconds, 0),
      byUser,
    };
  }

  /** O registo, se o ator o pode alterar: o seu, ou qualquer um sendo Administrador. */
  private async findOwned(id: string, actor: Actor) {
    const entry = await this.prisma.timeEntry.findUnique({ where: { id }, include: INCLUDE });
    if (!entry) throw new NotFoundException("Registo de tempo não encontrado");
    if (entry.userId !== actor.userId && actor.role !== "ADMINISTRADOR") {
      throw new ForbiddenException("Só podes alterar os teus registos de tempo");
    }
    return entry;
  }

  private assertClosedRange(startedAt: Date, endedAt: Date) {
    if (endedAt <= startedAt) throw new BadRequestException("O fim tem de ser depois do início");
    if (endedAt.getTime() > Date.now() + CLOCK_SKEW_MS) throw new BadRequestException("O registo não pode acabar no futuro");
    if (exceedsMaxDuration(startedAt, endedAt)) throw new BadRequestException(`Um registo tem no máximo ${MAX_ENTRY_HOURS} horas`);
  }

  /** Os registos de uma pessoa não se sobrepõem (o que está a correr conta até agora). */
  private async assertNoOverlap(userId: string, startedAt: Date, endedAt: Date | null, exceptId?: string) {
    const clash = await this.prisma.timeEntry.findFirst({
      where: {
        userId,
        ...(exceptId ? { id: { not: exceptId } } : {}),
        // Sem fim (a correr), não há limite superior.
        ...(endedAt ? { startedAt: { lt: endedAt } } : {}),
        OR: [{ endedAt: null }, { endedAt: { gt: startedAt } }],
      },
      select: { startedAt: true, endedAt: true },
    });
    if (clash) throw new ConflictException(`Sobrepõe-se a outro registo de tempo da mesma pessoa (${formatRange(clash)})`);
  }
}
