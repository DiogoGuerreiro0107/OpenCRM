import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { ROLES_KEY, WRITE_ROLES_KEY } from "../decorators/roles.decorator";

export const MUTATING_METHODS = ["POST", "PATCH", "PUT", "DELETE"];

/**
 * Aplicar SEMPRE depois do JwtAuthGuard: `@UseGuards(JwtAuthGuard, RolesGuard)`.
 * Não pode ser um guard global — os globais correm antes dos de controller e ainda não
 * teriam `request.user`.
 *
 *  - @Roles(...)      → restringe leitura e escrita;
 *  - @WriteRoles(...) → restringe só a escrita;
 *  - pedido de escrita sem nenhuma das duas → recusado (falha segura: uma rota nova nunca fica
 *    aberta por esquecimento).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const role: Role | undefined = request.user?.role;
    const targets = [context.getHandler(), context.getClass()];

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && (!role || !roles.includes(role))) {
      throw new ForbiddenException("Sem permissão para aceder a este recurso.");
    }

    if (MUTATING_METHODS.includes(request.method)) {
      const writeRoles = this.reflector.getAllAndOverride<Role[] | undefined>(WRITE_ROLES_KEY, targets) ?? roles;
      if (!writeRoles) {
        throw new ForbiddenException("Operação sem política de permissões definida — recusada por segurança.");
      }
      if (!role || !writeRoles.includes(role)) {
        throw new ForbiddenException("O teu papel não tem permissão para alterar este recurso.");
      }
    }

    return true;
  }
}
