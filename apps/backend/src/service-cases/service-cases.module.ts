import { Module } from "@nestjs/common";
import { TasksModule } from "../tasks/tasks.module";
import { WorkItemTypesModule } from "../work-item-types/work-item-types.module";
import { AutomationsModule } from "../automations/automations.module";
import { ServiceCasesController } from "./service-cases.controller";
import { ServiceCasesService } from "./service-cases.service";

/** Módulo opcional «Assistências» (Fase 4a). */
@Module({
  imports: [TasksModule, WorkItemTypesModule, AutomationsModule],
  controllers: [ServiceCasesController],
  providers: [ServiceCasesService],
})
export class ServiceCasesModule {}
