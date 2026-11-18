import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { ModulesService } from "../modules/modules.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { QueryLeadsDto } from "./dto/query-leads.dto";
import { isOpenStep } from "../workflows/workflow-steps";
import { decodeCursor, encodeCursor } from "../common/cursor";
import { QueryLeadPageDto } from "./dto/query-lead-page.dto";
import { assertKindAllowed, defaultKind, LeadMode, leadModeFrom } from "./lead-mode";

const LEAD_INCLUDE = {
  responsavel: { select: { id: true, name: true } },
  convertedDeal: { select: { id: true, title: true } },
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
};

/** Colunas internas (derivadas por trigger) que não saem na API. */
function withoutInternal<T extends { nextActionSort?: Date; searchText?: string }>(lead: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { nextActionSort, searchText, ...rest } = lead;
  return rest;
}

const PAGE_SIZE = 50;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly modules: ModulesService,
  ) {}

  async findAll(query: QueryLeadsDto) {
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

    return (await this.prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, include: LEAD_INCLUDE })).map(withoutInternal);
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id }, include: LEAD_INCLUDE });
    if (!lead) throw new NotFoundException("Lead não encontrado");
    return withoutInternal(lead);
  }

  // ---------- modo do módulo ----------

  mode(): LeadMode {
    return leadModeFrom(this.modules.getOptions("leads"));
  }

  async setMode(mode: LeadMode) {
    await this.modules.setOptions("leads", { mode });
    return { mode: this.mode() };
  }

  // ---------- listagem paginada (Fase 1b) ----------

  private pageWhere(query: Omit<QueryLeadPageDto, "cursor" | "limit">): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.kind) where.kind = query.kind;
    if (query.responsavelId) where.responsavelId = query.responsavelId;
    const term = query.search?.trim().toLowerCase();
    // searchText já está em minúsculas (trigger); «contém» usa o índice pg_trgm.
    if (term) where.searchText = { contains: term };
    return where;
  }

  /**
   * Página da lista, por CURSOR (próxima ação primeiro, sem data no fim; depois id). A página funda custa o mesmo que
   * a primeira (medido no teste de carga 1a). Um cursor inválido devolve a primeira página.
   */
  async page(query: QueryLeadPageDto) {
    const limit = query.limit ?? PAGE_SIZE;
    const where = this.pageWhere(query);
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      where.AND = [
        { OR: [{ nextActionSort: { gt: cursor.createdAt } }, { nextActionSort: cursor.createdAt, id: { gt: cursor.id } }] },
      ];
    }
    const rows = await this.prisma.lead.findMany({
      where,
      orderBy: [{ nextActionSort: "asc" }, { id: "asc" }],
      take: limit + 1,
      include: LEAD_INCLUDE,
    });
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map(withoutInternal),
      nextCursor: rows.length > limit && last ? encodeCursor(last.nextActionSort, last.id) : null,
    };
  }

  /** Contagens por estado (separadores), com os mesmos filtros da lista exceto o estado. */
  async counts(query: Omit<QueryLeadPageDto, "status" | "cursor" | "limit">) {
    const grouped = await this.prisma.lead.groupBy({ by: ["status"], where: this.pageWhere({ ...query, status: undefined }), _count: true });
    const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count]));
    return { total: grouped.reduce((sum, g) => sum + g._count, 0), byStatus };
  }

  // ---------- ligação a empresas/contactos existentes ----------

  /** Confirma que os registos ligados existem; sem empresa indicada, usa a do contacto. */
  private async resolveLinks(dto: { companyId?: string | null; contactId?: string | null }) {
    const data: { companyId?: string | null; contactId?: string | null } = {};
    if (dto.contactId) {
      const contact = await this.prisma.contact.findUnique({ where: { id: dto.contactId }, select: { id: true, companyId: true } });
      if (!contact) throw new BadRequestException("O contacto indicado não existe");
      data.contactId = contact.id;
      if (dto.companyId === undefined && contact.companyId) data.companyId = contact.companyId;
    }
    if (dto.companyId) {
      const company = await this.prisma.company.findUnique({ where: { id: dto.companyId }, select: { id: true } });
      if (!company) throw new BadRequestException("A empresa indicada não existe");
      data.companyId = company.id;
    }
    return data;
  }

  /** `options.id`: id escolhido por quem chama (a API pública reserva o id externo antes de criar o lead). */
  async create(dto: CreateLeadDto, creatorId: string, options: { id?: string } = {}) {
    const mode = this.mode();
    const kind = dto.kind ?? defaultKind(mode, dto);
    assertKindAllowed(mode, kind);
    const links = await this.resolveLinks(dto);
    const created = await this.prisma.lead.create({ data: { ...dto, ...links, kind, id: options.id }, include: LEAD_INCLUDE });
    const lead = withoutInternal(created);

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
      kind: lead.kind,
      name: lead.name,
      companyName: lead.companyName,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
    });

    return lead;
  }

  async update(id: string, dto: UpdateLeadDto) {
    const existing = await this.prisma.lead.findUnique({ where: { id }, select: { kind: true } });
    if (!existing) throw new NotFoundException("Lead não encontrado");
    // Mudar o tipo de uma lead tem de respeitar o modo; manter o tipo que já tinha é sempre permitido.
    if (dto.kind && dto.kind !== existing.kind) assertKindAllowed(this.mode(), dto.kind);
    const links = await this.resolveLinks(dto);
    return withoutInternal(await this.prisma.lead.update({ where: { id }, data: { ...dto, ...links }, include: LEAD_INCLUDE }));
  }

  async remove(id: string) {
    await this.ensureExists(id);
    // Ligações a ids externos (E0e) não têm chave estrangeira (são polimórficas): apagam-se juntamente.
    await this.prisma.$transaction([
      this.prisma.externalLink.deleteMany({ where: { entityType: "lead", entityId: id } }),
      this.prisma.customFieldValue.deleteMany({ where: { entityType: "LEAD", entityId: id } }),
      this.prisma.lead.delete({ where: { id } }),
    ]);
  }

  async convert(id: string, actingUserId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException("Lead não encontrado");
    // Sem o módulo de negócios uma lead convertida não tem negócio, por isso o estado também conta.
    if (lead.convertedDealId || lead.status === "CONVERTIDO") throw new BadRequestException("Este lead já foi convertido");

    // Sem o módulo de negócios a conversão cria só empresa e contacto: não exige funil nem cria negócio.
    const dealsEnabled = this.modules.isEnabled("deals");
    const pipeline = dealsEnabled
      ? await this.prisma.workflow.findFirst({ where: { entityType: "DEAL" }, orderBy: { createdAt: "asc" }, include: { steps: { orderBy: { order: "asc" } } } })
      : null;
    if (dealsEnabled && (!pipeline || pipeline.steps.length === 0)) {
      throw new BadRequestException("Nenhum funil configurado para associar a nova oportunidade");
    }
    const firstOpenStage = pipeline ? (pipeline.steps.find(isOpenStep) ?? pipeline.steps[0]) : null;

    // Tudo ou nada: sem transação, uma falha a meio deixava empresa/contacto órfãos e o lead por converter
    // (e uma nova tentativa duplicava os registos).
    return this.prisma.$transaction(async (tx) => {
      const company = lead.companyName
        ? await tx.company.create({ data: { name: lead.companyName } })
        : null;

      const contact = await tx.contact.create({
        data: {
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          companyId: company?.id,
        },
      });

      const deal =
        pipeline && firstOpenStage
          ? await tx.deal.create({
        data: {
          title: lead.companyName ? `Oportunidade — ${lead.companyName}` : `Oportunidade — ${lead.name}`,
          pipelineId: pipeline.id,
          stageId: firstOpenStage.id,
          contactId: contact.id,
          companyId: company?.id,
          ownerId: lead.responsavelId ?? actingUserId,
        },
      })
          : null;

      const noteContent = `Convertido a partir do lead "${lead.name}"${lead.source ? ` (origem: ${lead.source})` : ""}.`;
      await tx.timelineEvent.createMany({
        data: [
          { entityType: "CONTACT", entityId: contact.id, type: "SYSTEM", description: noteContent, userId: actingUserId },
          ...(company
            ? [{ entityType: "COMPANY" as const, entityId: company.id, type: "SYSTEM" as const, description: noteContent, userId: actingUserId }]
            : []),
          { entityType: "LEAD", entityId: lead.id, type: "SYSTEM", description: `Convertido para contacto "${contact.name}".`, userId: actingUserId },
        ],
      });

      const updatedLead = await tx.lead.update({
        where: { id },
        data: { status: "CONVERTIDO", convertedDealId: deal?.id ?? null },
        include: LEAD_INCLUDE,
      });

      return { lead: updatedLead, company, contact, deal };
    });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Lead não encontrado");
  }
}
