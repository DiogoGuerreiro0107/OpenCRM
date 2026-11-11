import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { QueryAuditDto } from "./dto/query-audit.dto";
import { decodeCursor, encodeCursor } from "../common/cursor";

export interface RecordAuditInput {
  action: string;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

const SECRET_KEY = /password|secret|token|apikey|authorization/i;
const MAX_STRING = 200;

/**
 * Remove qualquer chave com nome de segredo (em qualquer nível) e encurta textos longos. Defesa em profundidade:
 * mesmo que alguém ponha um campo sensível na lista branca de @Audit, não chega à base de dados.
 */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== "object") return value;
  if (depth >= 4) return "[omitido]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitizeMetadata(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = sanitizeMetadata(v, depth + 1);
  }
  return out;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Regista um evento. NUNCA lança: a ação que está a ser registada já aconteceu, e falhar aqui não a desfaz;
   * um erro fica no registo da aplicação (e é visível). Limite assumido: não é gravado na mesma transação da
   * ação, por isso uma falha da base de dados entre as duas pode perder o evento.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      const actor = input.actorId
        ? await this.prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true } })
        : null;
      await this.prisma.auditEvent.create({
        data: {
          action: input.action,
          actorId: input.actorId ?? null,
          actorName: actor?.name ?? null,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          metadata: input.metadata ? (sanitizeMetadata(input.metadata) as Prisma.InputJsonValue) : undefined,
          ip: input.ip ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Falha ao registar auditoria (${input.action}): ${(err as Error).message}`);
    }
  }

  /** Listagem por cursor (createdAt desc, id desc). O cursor é opaco para o cliente. */
  async list(query: QueryAuditDto) {
    const limit = query.limit ?? 50;
    const where: Prisma.AuditEventWhereInput = {
      actorId: query.actorId,
      targetId: query.targetId,
      action: query.action ? { startsWith: query.action } : undefined,
      createdAt: { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined },
    };

    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      where.OR = [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }];
    }

    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
  }
}

// O cursor passou para common/cursor.ts (partilhado com a API pública); reexportado por compatibilidade.
export { decodeCursor, encodeCursor };
