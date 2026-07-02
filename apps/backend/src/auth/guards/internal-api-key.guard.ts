import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedKey = request.headers["x-internal-api-key"];
    const expectedKey = this.config.get<string>("INTERNAL_API_KEY");

    if (!expectedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException("Chave interna inválida");
    }
    return true;
  }
}
