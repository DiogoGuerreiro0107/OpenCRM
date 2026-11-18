import { HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LeadsService } from "../leads/leads.service";
import { decodeCursor, encodeCursor } from "../common/cursor";
import { AuthenticatedApiKey } from "./api-key.guard";
import { V1ListQueryDto } from "./dto/v1-list-query.dto";
import { V1CreateLeadDto } from "./dto/v1-create-lead.dto";
import { publicCompany, publicContact, publicLead } from "./mappers";
import { ApiError } from "./v1-error.filter";

/** Dono das ligações a ids externos criadas pela API pública: a própria chave (duas integrações não colidem). */
export const apiKeyProvider = (apiKeyId: string) => `api_key:${apiKeyId}`;

const DEFAULT_LIMIT = 50;

/**
 * Filtro de sincronização: ordena por (updatedAt, id) crescente. Assim `updated_since` + cursor percorrem as
 * alterações sem repetir nem saltar, mesmo com várias linhas na mesma data.
 */
function syncWindow(query: V1ListQueryDto) {
  const and: Array<{ updatedAt?: { gte?: Date; gt?: Date }; OR?: unknown[] }> = [];
  if (query.updated_since) and.push({ updatedAt: { gte: new Date(query.updated_since) } });
  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    and.push({ OR: [{ updatedAt: { gt: cursor.createdAt } }, { updatedAt: cursor.createdAt, id: { gt: cursor.id } }] });
  }
  return and;
}

function page<T extends { id: string; updatedAt: Date }, P>(rows: T[], limit: number, map: (row: T) => P) {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { data: items.map(map), next_cursor: rows.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null };
}

@Injectable()
export class PublicApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  async listCompanies(query: V1ListQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.company.findMany({
      where: { AND: syncWindow(query) as Prisma.CompanyWhereInput[] },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    return page(rows, limit, publicCompany);
  }

  async getCompany(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException("Empresa não encontrada");
    return { data: publicCompany(company) };
  }

  async listContacts(query: V1ListQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.contact.findMany({
      where: { AND: syncWindow(query) as Prisma.ContactWhereInput[] },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    });
    return page(rows, limit, publicContact);
  }

  async getContact(id: string) {
    const contact = await this.prisma.contact.findUnique({ where: { id } });
    if (!contact) throw new NotFoundException("Contacto não encontrado");
    return { data: publicContact(contact) };
  }

  /**
   * Faz o mesmo que criar um lead na interface (tarefa «Contactar lead», webhook, tempo real). A tarefa fica
   * atribuída a quem criou a chave, porque uma chave não é uma pessoa.
   */
  async createLead(dto: V1CreateLeadDto, apiKey: AuthenticatedApiKey) {
    const leadId = randomUUID();
    if (dto.external_id) await this.reserveExternalId(apiKey, dto.external_id, leadId);

    try {
      const lead = await this.leads.create(
        {
          kind: dto.kind,
          name: dto.name,
          companyName: dto.company_name,
          taxId: dto.tax_id,
          phone: dto.phone,
          email: dto.email,
          source: dto.source ?? `API: ${apiKey.name}`,
          interest: dto.interest,
          notes: dto.notes,
        },
        apiKey.createdById,
        { id: leadId },
      );
      return { data: publicLead(lead, dto.external_id ?? null) };
    } catch (err) {
      // O lead não chegou a existir: liberta o id externo para a repetição poder criar.
      if (dto.external_id) {
        await this.prisma.externalLink.deleteMany({ where: { provider: apiKeyProvider(apiKey.id), entityType: "lead", entityId: leadId } });
      }
      throw err;
    }
  }

  /**
   * Reserva o id externo ANTES de criar o lead (o índice único decide entre pedidos concorrentes). Se já estiver
   * usado por esta chave, 409 com o id do lead existente: a integração não duplica registos, mesmo dias depois
   * (fora da janela de 24 h da idempotência).
   */
  private async reserveExternalId(apiKey: AuthenticatedApiKey, externalId: string, leadId: string) {
    const provider = apiKeyProvider(apiKey.id);
    try {
      await this.prisma.externalLink.create({ data: { provider, entityType: "lead", entityId: leadId, externalId } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
      const existing = await this.prisma.externalLink.findUnique({
        where: { provider_entityType_externalId: { provider, entityType: "lead", externalId } },
      });
      throw new ApiError(HttpStatus.CONFLICT, "conflict", "Já existe um lead com este external_id", {
        existing_id: existing?.entityId ?? null,
      });
    }
  }
}
