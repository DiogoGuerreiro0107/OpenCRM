import { Global, Module } from "@nestjs/common";
import { ModuleGuard } from "./module.guard";
import { ModulesController } from "./modules.controller";
import { ModulesService } from "./modules.service";

/** Global: qualquer serviço pode perguntar se um módulo está ativo, e o ModuleGuard usa-se em todos os controllers. */
@Global()
@Module({
  controllers: [ModulesController],
  providers: [ModulesService, ModuleGuard],
  exports: [ModulesService, ModuleGuard],
})
export class ModulesModule {}
