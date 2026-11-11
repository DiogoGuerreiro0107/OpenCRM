import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ApiKey } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { isApiScope } from "../public-api/scopes";
import { generateApiKey } from "./api-key";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

/** O que a API de gestão devolve de uma chave: NUNCA o hash nem a chave. */
export function apiKeyView(k: ApiKey) {
  const now = Date.now();
  const status = k.revokedAt ? "revoked" : k.expiresAt && k.expiresAt.getTime() <= now ? "expired" : "active";
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    rateLimitPerMinute: k.rateLimitPerMinute,
    createdById: k.createdById,
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
    status,
  };
}

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const keys = await this.prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } });
    return keys.map(apiKeyView);
  }

  /** Devolve a chave completa UMA ÚNICA VEZ (`key`); depois só se vê o prefixo. */
  async create(dto: CreateApiKeyDto, creatorId: string) {
    const unknown = dto.scopes.filter((s) => !isApiScope(s));
    if (unknown.length > 0) throw new BadRequestException(`Âmbito desconhecido: ${unknown.join(", ")}`);
    if (dto.expiresAt && new Date(dto.expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException("A data de expiração tem de ser futura");
    }

    const generated = generateApiKey();
    const record = await this.prisma.apiKey.create({
      data: {
        name: dto.name,
        prefix: generated.prefix,
        keyHash: generated.hash,
        scopes: dto.scopes,
        rateLimitPerMinute: dto.rateLimitPerMinute ?? 120,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: creatorId,
      },
    });
    return { ...apiKeyView(record), key: generated.key };
  }

  /** Revogar é definitivo e imediato. Revogar uma chave já revogada não muda nada (idempotente). */
  async revoke(id: string) {
    const existing = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Chave não encontrada");
    if (existing.revokedAt) return apiKeyView(existing);
    return apiKeyView(await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } }));
  }
}
