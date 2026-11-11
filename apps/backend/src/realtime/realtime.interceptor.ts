import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { MUTATING_METHODS } from "../auth/guards/roles.guard";
import { RealtimeService } from "./realtime.service";

/** Rotas cujo primeiro segmento é um "recurso" diferente do nome pelo qual o frontend as conhece. */
const RESOURCE_ALIASES: Record<string, string> = { stages: "pipelines" };

/** Primeiro segmento do caminho: "/deals/123/move?x=1" -> "deals". */
export function resourceOf(url: string): string | null {
  const segments = url.split("?")[0].split("/").filter(Boolean);
  // API pública: /api/v1/leads -> "leads" (as integrações escrevem nos mesmos recursos que a interface mostra).
  const first = segments[0] === "api" && segments[1] === "v1" ? segments[2] : segments[0];
  if (!first || first === "auth") return null; // login/refresh/passwords não são alterações de dados do CRM
  return RESOURCE_ALIASES[first] ?? first;
}

/**
 * Depois de QUALQUER pedido de escrita bem-sucedido, avisa os browsers ligados. Global: cobre todos os
 * controllers atuais e os futuros sem ser preciso lembrar-se. Pedidos recusados (guards, validação, erros) não
 * chegam aqui com sucesso e por isso não emitem.
 */
@Injectable()
export class RealtimeInterceptor implements NestInterceptor {
  constructor(private readonly realtime: RealtimeService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    if (!MUTATING_METHODS.includes(request.method)) return next.handle();

    const resource = resourceOf(request.originalUrl ?? request.url ?? "");
    if (!resource) return next.handle();

    return next.handle().pipe(tap(() => this.realtime.emit(resource, request.method)));
  }
}
