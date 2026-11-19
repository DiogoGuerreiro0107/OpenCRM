import { Global, Module } from "@nestjs/common";
import { WorkflowsService } from "./workflows.service";
import { WorkflowsController } from "./workflows.controller";

/** Núcleo: fluxos genéricos (Fase 0c; rotas /workflows na 2b). Global para os módulos que tiverem fluxos (negócios, tarefas). */
@Global()
@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
