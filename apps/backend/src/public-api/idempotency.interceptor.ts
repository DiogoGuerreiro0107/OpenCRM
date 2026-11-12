import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { catchError, concatMap, from, Observable, of, throwError } from "rxjs";
import { PrismaService } from "../prisma/prisma.service";
import { IDEMPOTENT_KEY, IN_PROGRESS_TTL_MS, isValidIdempotencyKey, RECORD_TTL_MS, requestFingerprint } from "./idempotency";
import { ApiError } from "./v1-error.filter";
import { AuthenticatedApiKey } from "./api-key.guard";

/**
 * Idempotência da API pública (rotas com @Idempotent()):
 *  1. grava `(chave de API, Idempotency-Key)` ANTES de executar (o índice único trata a concorrência);
 *  2. repetir o mesmo pedido devolve a MESMA resposta (cabeçalho `Idempotent-Replayed: true`);
 *  3. a mesma Idempotency-Key com outro corpo/caminho → 422; um pedido igual ainda em curso → 409;
 *  4. só as respostas bem-sucedidas ficam guardadas: um erro apaga o registo, para a repetição voltar a executar.
 * O escopo é a chave de API: duas integrações podem usar o mesmo texto sem colidir.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<{ required?: boolean } | undefined>(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const apiKey = request.apiKey as AuthenticatedApiKey | undefined;
    const header = request.headers["idempotency-key"];

    if (header === undefined) {
      if (options.required) {
        return throwError(() => new ApiError(HttpStatus.BAD_REQUEST, "invalid_request", "O cabeçalho Idempotency-Key é obrigatório nesta rota"));
      }
      return next.handle();
    }
    if (!apiKey || !isValidIdempotencyKey(header)) {
      return throwError(() => new ApiError(HttpStatus.BAD_REQUEST, "invalid_request", "Idempotency-Key inválido (8 a 128 caracteres visíveis, sem espaços)"));
    }

    const path = String(request.originalUrl ?? request.url).split("?")[0];
    const fingerprint = requestFingerprint(request.method, path, request.body);

    return from(this.begin(apiKey.id, header, request.method, path, fingerprint)).pipe(
      concatMap((replay) => {
        if (replay) {
          response.setHeader("Idempotent-Replayed", "true");
          response.status(replay.status);
          return of(replay.body);
        }
        return next.handle().pipe(
          // Só erros do próprio pedido apagam o registo (a repetição volta a executar). Se a gravação do resultado
          // falhar depois de o pedido ter sucesso, o registo fica «em curso» (e a repetição recebe 409 até expirar):
          // preferível a executar duas vezes.
          catchError((err) => from(this.discard(apiKey.id, header)).pipe(concatMap(() => throwError(() => err)))),
          concatMap(async (body) => {
            await this.complete(apiKey.id, header, response.statusCode, body);
            return body;
          }),
        );
      }),
    );
  }

  /** Devolve a resposta a repetir, ou null se este pedido deve ser executado. Lança 409/422 nos outros casos. */
  private async begin(apiKeyId: string, key: string, method: string, path: string, requestHash: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.prisma.idempotencyRecord.create({ data: { apiKeyId, key, method, path, requestHash } });
        return null; // primeira vez: executar
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
      }

      const existing = await this.prisma.idempotencyRecord.findUnique({ where: { apiKeyId_key: { apiKeyId, key } } });
      if (!existing) continue; // apagado entretanto: tenta criar outra vez

      if (existing.requestHash !== requestHash) {
        throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_reuse", "Este Idempotency-Key já foi usado com um pedido diferente");
      }
      if (existing.status !== null) {
        return { status: existing.status, body: existing.responseBody };
      }
      if (Date.now() - existing.createdAt.getTime() > IN_PROGRESS_TTL_MS) {
        // Abandonado (o backend pode ter caído a meio): liberta e tenta outra vez.
        await this.prisma.idempotencyRecord.deleteMany({ where: { id: existing.id, status: null } });
        continue;
      }
      throw new ApiError(HttpStatus.CONFLICT, "conflict", "Já existe um pedido igual em curso com este Idempotency-Key");
    }
    throw new ApiError(HttpStatus.CONFLICT, "conflict", "Não foi possível reservar o Idempotency-Key; tenta outra vez");
  }

  private complete(apiKeyId: string, key: string, status: number, body: unknown) {
    return this.prisma.idempotencyRecord.update({
      where: { apiKeyId_key: { apiKeyId, key } },
      data: { status, responseBody: (body ?? Prisma.JsonNull) as Prisma.InputJsonValue, completedAt: new Date() },
    });
  }

  private async discard(apiKeyId: string, key: string) {
    await this.prisma.idempotencyRecord.deleteMany({ where: { apiKeyId, key, status: null } });
  }

  /** Limpeza diária dos registos com mais de 24 h. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOld() {
    await this.prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RECORD_TTL_MS) } } });
  }
}
