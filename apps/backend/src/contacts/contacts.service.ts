import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(search?: string) {
    return this.prisma.contact.findMany({
      where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
      orderBy: { name: "asc" },
      include: { company: { select: { id: true, name: true } } },
    });
  }

  async findOne(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        company: true,
        activities: {
          orderBy: { createdAt: "desc" },
          include: { author: { select: { id: true, name: true } } },
        },
      },
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
