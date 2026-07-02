import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCompanyDto } from "./dto/create-company.dto";
import { UpdateCompanyDto } from "./dto/update-company.dto";
import { QueryCompaniesDto } from "./dto/query-companies.dto";

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryCompaniesDto) {
    const where: Prisma.CompanyWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { legalName: { contains: query.search, mode: "insensitive" } },
        { taxId: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.ownerId) where.ownerId = query.ownerId;

    return this.prisma.company.findMany({
      where,
      orderBy: { name: "asc" },
      include: { _count: { select: { contacts: true } } },
    });
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        contacts: { orderBy: { name: "asc" } },
      },
    });
    if (!company) throw new NotFoundException("Empresa não encontrada");
    return company;
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
    await this.prisma.company.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Empresa não encontrada");
  }
}
