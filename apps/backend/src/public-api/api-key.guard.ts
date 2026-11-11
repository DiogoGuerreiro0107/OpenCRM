import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { extractBearer, hashApiKey, looksLikeApiKey } from "../api-keys/api-key";
import { SlidingWindowLimiter } from "./rate-limiter";
import { SCOPES_KEY } from "./scopes.decorator";

/** O que o guard põe em `request.apiKey` (nunca o hash). */
export interface AuthenticatedApiKey {
  id: string;
  name: string;
  scopes: string[];
  createdById: string;
}

/** `lastUsedAt` grava-se no máximo uma vez por minuto por chave (não escrever na base de dados a cada pedido). */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Porta da API pública: aceita SÓ chaves de API (`Authorization: Bearer ocrm_…`), nunca JWT de utilizador.
 * Chave inexistente, de formato errado, revogada ou expirada dão o MESMO 401 (não revela qual).
 * Ordem: autenticar → limite por chave → âmbito. O limite vem antes do âmbito para que uma chave não possa
 * sondar âmbitos sem custo.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly limiter = new SlidingWindowLimiter();
  private readonly lastTouch = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const provided = extractBearer(request.headers["authorization"]);
    if (!looksLikeApiKey(provided)) throw new UnauthorizedException("Chave de API em falta ou inválida");

    const record = await this.prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(provided) } });
    const now = new Date();
    if (!record || record.revokedAt || (record.expiresAt && record.expiresAt <= now)) {
      throw new UnauthorizedException("Chave de API em falta ou inválida");
    }

    const decision = this.limiter.consume(record.id, record.rateLimitPerMinute);
    if (!decision.allowed) {
      response.setHeader("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException("Limite de pedidos excedido", HttpStatus.TOO_MANY_REQUESTS);
    }

    // Falha fechada: uma rota sem @Scopes() nunca devia existir (há um teste), mas se existir, ninguém passa.
    const required = this.reflector.getAllAndOverride<string[] | undefined>(SCOPES_KEY, [context.getHandler(), context.getClass()]);
    if (!required) throw new ForbiddenException("Âmbito insuficiente");
    if (!required.every((scope) => record.scopes.includes(scope))) throw new ForbiddenException("Âmbito insuficiente");

    this.touch(record.id, now);
    request.apiKey = { id: record.id, name: record.name, scopes: record.scopes, createdById: record.createdById } satisfies AuthenticatedApiKey;
    return true;
  }

  private touch(id: string, now: Date) {
    const last = this.lastTouch.get(id) ?? 0;
    if (now.getTime() - last < TOUCH_INTERVAL_MS) return;
    this.lastTouch.set(id, now.getTime());
    if (this.lastTouch.size > 1000) this.limiter.prune();
    // Não se espera nem se propaga erro: é só informação para a página de gestão.
    void this.prisma.apiKey.update({ where: { id }, data: { lastUsedAt: now } }).catch(() => undefined);
  }
}
