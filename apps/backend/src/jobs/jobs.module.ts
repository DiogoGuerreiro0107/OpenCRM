import { Global, Module } from "@nestjs/common";
import { JobsController } from "./jobs.controller";
import { JobsScheduler } from "./jobs.scheduler";
import { JobsService } from "./jobs.service";

/** Núcleo: tarefas agendadas (Fase E1.2). Global: os serviços donos registam o trabalho com `JobsService.handle`. */
@Global()
@Module({
  controllers: [JobsController],
  providers: [JobsService, JobsScheduler],
  exports: [JobsService],
})
export class JobsModule {}
