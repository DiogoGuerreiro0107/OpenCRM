import { Module } from "@nestjs/common";
import { TasksModule } from "../tasks/tasks.module";
import { WorkItemTypesModule } from "../work-item-types/work-item-types.module";
import { AutomationsModule } from "../automations/automations.module";
import { ServiceCasesController } from "./service-cases.controller";
import { ServiceCasesService } from "./service-cases.service";
import { ServicePartsService } from "./service-parts.service";
import { ServiceIndicatorsService } from "./service-indicators.service";

/** Módulo opcional «Assistências» (Fase 4a; peças e indicadores na 4c). */
@Module({
  imports: [TasksModule, WorkItemTypesModule, AutomationsModule],
  controllers: [ServiceCasesController],
  providers: [ServiceCasesService, ServicePartsService, ServiceIndicatorsService],
})
export class ServiceCasesModule {}
