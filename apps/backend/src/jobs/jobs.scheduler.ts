import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { JOBS } from "./job-catalog";
import { JobsService } from "./jobs.service";

/**
 * O ÚNICO sítio com `@Cron` (Fase E1.2): marca a hora de cada tarefa do catálogo e passa-a ao registo, que decide se
 * corre e guarda o resultado. Teste estrutural: jobs-structure.spec.ts.
 */
@Injectable()
export class JobsScheduler {
  constructor(private readonly jobs: JobsService) {}

  @Cron(JOBS["webhooks.deliver"].cron)
  webhooksDeliver() {
    return this.jobs.trigger("webhooks.deliver");
  }

  @Cron(JOBS["zadarma.sync"].cron)
  zadarmaSync() {
    return this.jobs.trigger("zadarma.sync");
  }

  @Cron(JOBS["automations.scheduled"].cron)
  automationsScheduled() {
    return this.jobs.trigger("automations.scheduled");
  }

  @Cron(JOBS["automations.purge-runs"].cron)
  automationsPurgeRuns() {
    return this.jobs.trigger("automations.purge-runs");
  }

  @Cron(JOBS["api.idempotency-purge"].cron)
  apiIdempotencyPurge() {
    return this.jobs.trigger("api.idempotency-purge");
  }

  @Cron(JOBS["jobs.purge-runs"].cron)
  jobsPurgeRuns() {
    return this.jobs.trigger("jobs.purge-runs");
  }
}
