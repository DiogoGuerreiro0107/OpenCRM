import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { QueryLeadsDto } from "./dto/query-leads.dto";

const LEAD_INCLUDE = {
  responsavel: { select: { id: true, name: true } },
  convertedDeal: { select: { id: true, title: true } },
};

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  findAll(query: QueryLeadsDto) {
    const where: Prisma.LeadWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.responsavelId) where.responsavelId = query.responsavelId;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { companyName: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
        { phone: { contains: query.search, mode: "insensitive" } },
      ];
    }

    return this.prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, include: LEAD_INCLUDE });
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id }, include: LEAD_INCLUDE });
    if (!lead) throw new NotFoundException("Lead não encontrado");
    return lead;
  }

  async create(dto: CreateLeadDto, creatorId: string) {
    const lead = await this.prisma.lead.create({ data: dto, include: LEAD_INCLUDE });

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    await this.prisma.task.create({
      data: {
        title: `Contactar lead: ${lead.name}`,
        status: "PENDING",
        dueDate,
        assigneeId: lead.responsavelId ?? creatorId,
        leadId: lead.id,
      },
    });

    this.webhooks.trigger("lead.created", {
      leadId: lead.id,
      name: lead.name,
      companyName: lead.companyName,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
    });

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto) {
    await this.ensureExists(id);
    return this.prisma.lead.update({ where: { id }, data: dto, include: LEAD_INCLUDE });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.lead.delete({ where: { id } });
  }

  async convert(id: string, actingUserId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead não encontrado");
    if (lead.convertedDealId) throw new BadRequestException("Este lead já foi convertido");

    const pipeline = await this.prisma.pipeline.findFirst({
      include: { stages: { orderBy: { order: "asc" } } },
    });
    if (!pipeline || pipeline.stages.length === 0) {
      throw new BadRequestException("Nenhum funil configurado para associar a nova oportunidade");
    }
    const firstOpenStage = pipeline.stages.find((s) => s.type === "OPEN") ?? pipeline.stages[0];

    const company = lead.companyName
      ? await this.prisma.company.create({ data: { name: lead.companyName } })
      : null;

    const contact = await this.prisma.contact.create({
      data: {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        companyId: company?.id,
      },
    });

    const deal = await this.prisma.deal.create({
      data: {
        title: lead.companyName ? `Oportunidade — ${lead.companyName}` : `Oportunidade — ${lead.name}`,
        pipelineId: pipeline.id,
        stageId: firstOpenStage.id,
        contactId: contact.id,
        companyId: company?.id,
        ownerId: lead.responsavelId ?? actingUserId,
      },
    });

    const noteContent = `Convertido a partir do lead "${lead.name}"${lead.source ? ` (origem: ${lead.source})` : ""}.`;
    await this.prisma.activityLog.create({
      data: {
        type: "NOTE",
        content: noteContent,
        contactId: contact.id,
        companyId: company?.id,
        authorId: actingUserId,
      },
    });

    const updatedLead = await this.prisma.lead.update({
      where: { id },
      data: { status: "CONVERTIDO", convertedDealId: deal.id },
      include: LEAD_INCLUDE,
    });

    return { lead: updatedLead, company, contact, deal };
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Lead não encontrado");
  }
}
