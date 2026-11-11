import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ModuleId } from "./module-manifest";
import { MODULE_KEY } from "./require-module.decorator";
import { ModulesService } from "./modules.service";

/**
 * Aplicar DEPOIS do JwtAuthGuard e do RolesGuard: `@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)`.
 * Assim quem não tem sessão continua a receber 401 e não fica a saber que módulos existem ou estão desligados.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly modules: ModulesService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ModuleId | undefined>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;
    if (!this.modules.isEnabled(required)) throw new NotFoundException();
    return true;
  }
}
