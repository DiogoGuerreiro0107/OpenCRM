import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { concatMap, Observable } from "rxjs";
import { AUDIT_KEY, AuditOptions } from "./audit.decorator";
import { AuditService } from "./audit.service";

type AuditMeta = AuditOptions & { action: string };

/**
 * Global. Nas rotas marcadas com @Audit, regista o evento DEPOIS de o pedido ter sido bem-sucedido (um pedido
 * recusado por permissões, validação ou erro não altera nada e por isso não é registado como ação feita).
 * Corre depois dos guards, por isso `request.user` já existe.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMeta | undefined>(AUDIT_KEY, [context.getHandler(), context.getClass()]);
    if (!meta) return next.handle();

    const request = context.switchToHttp().getRequest();
    return next.handle().pipe(
      concatMap(async (response) => {
        const paramId = request.params?.[meta.param ?? "id"];
        const responseId = response && typeof response === "object" ? (response as { id?: unknown }).id : undefined;
        const body = (request.body ?? {}) as Record<string, unknown>;
        const picked = Object.fromEntries((meta.fields ?? []).filter((f) => f in body).map((f) => [f, body[f]]));
        for (const [label, names] of Object.entries(meta.presence ?? {})) {
          if (names.some((n) => body[n] !== undefined)) picked[label] = "alteradas";
        }
        const metadata = Object.keys(picked).length > 0 ? picked : null;

        // Espera-se pela escrita (que nunca lança) para o evento já existir quando o cliente recebe o sucesso.
        await this.audit.record({
          action: meta.action,
          actorId: request.user?.userId ?? null,
          targetType: meta.target ?? null,
          targetId: typeof paramId === "string" ? paramId : typeof responseId === "string" ? responseId : null,
          metadata,
          ip: request.ip ?? null,
        });
        return response;
      }),
    );
  }
}
