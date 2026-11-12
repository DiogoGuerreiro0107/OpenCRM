import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LeadsService } from "../leads/leads.service";
import { decodeCursor, encodeCursor } from "../common/cursor";
import { AuthenticatedApiKey } from "./api-key.guard";
import { V1ListQueryDto } from "./dto/v1-list-query.dto";
import { V1CreateLeadDto } from "./dto/v1-create-lead.dto";
import { publicCompany, publicContact, publicLead } from "./mappers";

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
    const lead = await this.leads.create(
      {
        name: dto.name,
        companyName: dto.company_name,
        phone: dto.phone,
        email: dto.email,
        source: dto.source ?? `API: ${apiKey.name}`,
        interest: dto.interest,
        notes: dto.notes,
      },
      apiKey.createdById,
    );
    return { data: publicLead(lead) };
  }
}
