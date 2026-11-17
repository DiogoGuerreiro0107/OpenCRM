import { Global, Module } from "@nestjs/common";
import { WorkflowsService } from "./workflows.service";

/** Núcleo: fluxos genéricos (Fase 0c). Global para os módulos que tiverem fluxos (hoje: negócios). Sem rotas próprias. */
@Global()
@Module({
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
