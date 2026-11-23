import { Module } from "@nestjs/common";
import { AutomationsModule } from "../automations/automations.module";
import { TimeEntriesController } from "./time-entries.controller";
import { TimeEntriesService } from "./time-entries.service";

/** Registo de tempo nos itens de trabalho (Fase 4b). Núcleo das tarefas: sem módulo opcional próprio. */
@Module({
  imports: [AutomationsModule],
  controllers: [TimeEntriesController],
  providers: [TimeEntriesService],
  exports: [TimeEntriesService],
})
export class TimeEntriesModule {}
