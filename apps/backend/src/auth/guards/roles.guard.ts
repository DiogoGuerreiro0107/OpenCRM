import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { ROLES_KEY, WRITE_AREA_KEY, WRITE_ROLES_KEY } from "../decorators/roles.decorator";
import { PermissionsService } from "../permissions.service";
import { WriteArea } from "../permissions";

export const MUTATING_METHODS = ["POST", "PATCH", "PUT", "DELETE"];

/**
 * Aplicar SEMPRE depois do JwtAuthGuard: `@UseGuards(JwtAuthGuard, RolesGuard)`.
 * Não pode ser um guard global — os globais correm antes dos de controller e ainda não
 * teriam `request.user`.
 *
 *  - @Roles(...)      → restringe leitura e escrita;
 *  - @WriteRoles(...) → restringe só a escrita, com uma lista FIXA (administração);
 *  - @WriteArea(...)  → restringe só a escrita, com a lista CONFIGURÁVEL dessa área (Fase 0d), lida em cada pedido;
 *  - o que estiver no método sobrepõe-se ao que estiver na classe;
 *  - pedido de escrita sem nenhuma política → recusado (falha segura: uma rota nova nunca fica
 *    aberta por esquecimento).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const role: Role | undefined = request.user?.role;
    const targets = [context.getHandler(), context.getClass()];

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && (!role || !roles.includes(role))) {
      throw new ForbiddenException("Sem permissão para aceder a este recurso.");
    }

    if (MUTATING_METHODS.includes(request.method)) {
      const writeRoles = this.writePolicy(context) ?? roles;
      if (!writeRoles) {
        throw new ForbiddenException("Operação sem política de permissões definida — recusada por segurança.");
      }
      if (!role || !writeRoles.includes(role)) {
        throw new ForbiddenException("O teu papel não tem permissão para alterar este recurso.");
      }
    }

    return true;
  }

  /** Política de escrita do método, se houver; senão a da classe. Uma área é resolvida AGORA (configurável). */
  private writePolicy(context: ExecutionContext): Role[] | undefined {
    for (const target of [context.getHandler(), context.getClass()]) {
      const area = this.reflector.get<WriteArea | undefined>(WRITE_AREA_KEY, target);
      if (area) return this.permissions.rolesFor(area);
      const fixed = this.reflector.get<Role[] | undefined>(WRITE_ROLES_KEY, target);
      if (fixed) return fixed;
    }
    return undefined;
  }
}
