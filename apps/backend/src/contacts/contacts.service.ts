import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";
import { QueryContactsDto } from "./dto/query-contacts.dto";

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryContactsDto) {
    const where: Prisma.ContactWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
        { mobilePhone: { contains: query.search, mode: "insensitive" } },
      ];
    }
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.companyId) where.companyId = query.companyId;

    return this.prisma.contact.findMany({
      where,
      orderBy: { name: "asc" },
      include: { company: { select: { id: true, name: true } } },
    });
  }

  async findOne(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: { company: true },
    });
    if (!contact) throw new NotFoundException("Contacto não encontrado");
    return contact;
  }

  create(dto: CreateContactDto) {
    return this.prisma.contact.create({ data: dto });
  }

  async update(id: string, dto: UpdateContactDto) {
    await this.ensureExists(id);
    return this.prisma.contact.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.contact.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.contact.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Contacto não encontrado");
  }
}
