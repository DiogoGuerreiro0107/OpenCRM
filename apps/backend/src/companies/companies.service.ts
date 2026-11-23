import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { QueryCompaniesDto } from "./dto/query-companies.dto";
import { foldSearch } from "../common/search-text";
import { KeyField, orderByKey, readPage } from "../common/pagination";

/** Chave da lista de empresas e de contactos (nome, id): cursor e ordem. */
const NAME_KEY: KeyField[] = [
  { field: "name", dir: "asc", kind: "string" },
  { field: "id", dir: "asc", kind: "string" },
];

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Página da lista, por (nome, id). Os seletores pedem só a primeira, com `limit` pequeno. */
  async findAll(query: QueryCompaniesDto) {
    const where: Prisma.CompanyWhereInput = {};
    // searchText = nome, nome fiscal, NIF, telefone e email sem acentos (trigger); «contém» usa o índice pg_trgm.
    const term = query.search ? foldSearch(query.search.trim()) : "";
    if (term) where.searchText = { contains: term };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.supplier) where.isSupplier = query.supplier === "true";

    const page = await readPage(NAME_KEY, query, (after, take) =>
      this.prisma.company.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(NAME_KEY), take }),
    );
    // Contactos por empresa SÓ das empresas desta página. O `_count` do Prisma agregava a tabela de contactos inteira
    // (medido: 156 ms com 200 000 contactos, docs/plano-paginacao-listagens.md).
    const counts = await this.prisma.contact.groupBy({
      by: ["companyId"],
      where: { companyId: { in: page.items.map((c) => c.id) } },
      _count: true,
    });
    const byCompany = new Map(counts.map((c) => [c.companyId, c._count]));
    return { ...page, items: page.items.map((c) => ({ ...c, _count: { contacts: byCompany.get(c.id) ?? 0 } })) };
  }

  async findOne(id: string) {
    // Os contactos da empresa não vêm aqui (podem ser muitos): a ficha pede-os paginados a GET /contacts?companyId.
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException("Empresa não encontrada");
    return { ...company, _count: { contacts: await this.prisma.contact.count({ where: { companyId: id } }) } };
  }

  async create(dto: CreateCompanyDto, authorId: string) {
    const company = await this.prisma.company.create({ data: dto });
    await this.prisma.timelineEvent.create({
      data: {
        entityType: "COMPANY",
        entityId: company.id,
        type: "SYSTEM",
        description: `Empresa "${company.name}" criada.`,
        userId: authorId,
      },
    });
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto) {
    await this.ensureExists(id);
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    // Os valores dos campos personalizados não têm chave estrangeira (polimórficos): apagam-se juntamente.
    await this.prisma.$transaction([
      this.prisma.customFieldValue.deleteMany({ where: { entityType: "COMPANY", entityId: id } }),
      this.prisma.company.delete({ where: { id } }),
    ]);
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Empresa não encontrada");
  }
}
