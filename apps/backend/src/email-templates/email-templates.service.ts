import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateEmailTemplateDto } from "./dto/create-email-template.dto";
import { UpdateEmailTemplateDto } from "./dto/update-email-template.dto";

@Injectable()
export class EmailTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.emailTemplate.findMany({ orderBy: { name: "asc" } });
  }

  async findOne(id: string) {
    const template = await this.prisma.emailTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException("Modelo de email não encontrado");
    return template;
  }

  create(dto: CreateEmailTemplateDto) {
    return this.prisma.emailTemplate.create({ data: dto });
  }

  async update(id: string, dto: UpdateEmailTemplateDto) {
    await this.ensureExists(id);
    return this.prisma.emailTemplate.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.emailTemplate.delete({ where: { id } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.emailTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Modelo de email não encontrado");
  }
}
