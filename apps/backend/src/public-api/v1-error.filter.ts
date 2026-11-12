import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";

/** Códigos de erro estáveis da API pública (fazem parte do contrato da v1: só se acrescentam). */
export type ApiErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "insufficient_scope"
  | "not_found"
  | "conflict"
  | "idempotency_key_reuse"
  | "rate_limited"
  | "internal_error";

const CODE_BY_STATUS: Record<number, ApiErrorCode> = {
  [HttpStatus.BAD_REQUEST]: "invalid_request",
  [HttpStatus.UNAUTHORIZED]: "unauthorized",
  [HttpStatus.FORBIDDEN]: "insufficient_scope",
  [HttpStatus.NOT_FOUND]: "not_found",
  [HttpStatus.CONFLICT]: "conflict",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "idempotency_key_reuse",
  [HttpStatus.TOO_MANY_REQUESTS]: "rate_limited",
};

/** Exceção com código explícito (quando o estado HTTP sozinho não chega para o identificar). */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message, status);
  }
}

/**
 * Formato único de erro da API pública: `{ "error": { "code", "message", "details?" } }`.
 * Nunca devolve mensagens internas nem pilhas num erro 500 (ficam só nos registos).
 */
@Catch()
export class V1ExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("API v1");

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const raw = typeof body === "string" ? body : ((body as { message?: unknown }).message ?? exception.message);
      // Erros de validação: o ValidationPipe devolve uma lista de mensagens.
      const details = Array.isArray(raw) ? raw : exception instanceof ApiError ? exception.details : undefined;
      const message = Array.isArray(raw) ? "Pedido inválido" : String(raw);
      const code = exception instanceof ApiError ? exception.code : (CODE_BY_STATUS[status] ?? (status >= 500 ? "internal_error" : "invalid_request"));
      return response.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}) } });
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: "internal_error", message: "Erro interno" } });
  }
}
