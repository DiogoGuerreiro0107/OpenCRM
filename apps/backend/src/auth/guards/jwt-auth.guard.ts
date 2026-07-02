import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

const MUTATING_METHODS = ["POST", "PATCH", "PUT", "DELETE"];

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  handleRequest(err: unknown, user: any, info: unknown, context: ExecutionContext) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    const req = context.switchToHttp().getRequest();
    const isMutating = MUTATING_METHODS.includes(req.method);
    const isAuthRoute = req.originalUrl?.startsWith("/auth");

    if (isMutating && !isAuthRoute && user.role === "LEITURA_APENAS") {
      throw new ForbiddenException("Utilizador em modo só de leitura — operação não permitida.");
    }

    return user;
  }
}
