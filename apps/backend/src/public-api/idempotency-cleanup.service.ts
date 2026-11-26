import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JobsService } from "../jobs/jobs.service";
import { JobOutcome } from "../jobs/job-catalog";
import { RECORD_TTL_MS } from "./idempotency";

/**
 * Limpeza diária dos registos de idempotência com mais de 24 h (tarefa «api.idempotency-purge», Fase E1.2). Num
 * serviço à parte: o interceptor é criado uma vez por controller que o usa, e uma tarefa tem um só dono.
 */
@Injectable()
export class IdempotencyCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    jobs: JobsService,
  ) {
    jobs.handle("api.idempotency-purge", () => this.purgeOld());
  }

  async purgeOld(): Promise<JobOutcome> {
    const { count } = await this.prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RECORD_TTL_MS) } } });
    return { summary: `${count} ${count === 1 ? "registo apagado" : "registos apagados"}`, idle: count === 0 };
  }
}
