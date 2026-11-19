import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Company, Contact, Lead, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { ModulesService } from "../modules/modules.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { isOpenStep } from "../workflows/workflow-steps";
import { decodeCursor, encodeCursor } from "../common/cursor";
import { foldSearch } from "../common/search-text";
import { QueryLeadPageDto } from "./dto/query-lead-page.dto";
import { assertKindAllowed, defaultKind, LeadMode, leadModeFrom } from "./lead-mode";
import { companyNameOf, ConversionOutcome, hasPerson, MIN_PHONE_DIGITS, normalizePhone, normalizeTaxId, PHONE_SQL, TAX_ID_SQL } from "./lead-conversion";

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

const COMPANY_OUTCOME_LABEL: Record<ConversionOutcome, string> = { LINKED: "já ligada à lead", MATCHED: "já existia, mesmo NIF", CREATED: "nova" };
const CONTACT_OUTCOME_LABEL: Record<ConversionOutcome, string> = { LINKED: "já ligado à lead", MATCHED: "já existia, mesmo email ou telefone", CREATED: "novo" };

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
    private readonly modules: ModulesService,
  ) {}

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
    const term = query.search ? foldSearch(query.search.trim()) : "";
    // searchText já está em minúsculas e sem acentos (trigger); «contém» usa o índice pg_trgm.
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
    await this.prisma.workItem.create({
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

  /**
   * Conversão por tipo (Fase 1c, docs/plano-fase-1-leads.md): usa os registos ligados; senão procura duplicados
   * (empresa pelo NIF; contacto pelo email e depois pelo telefone) e liga-os; senão cria. Tudo numa transação.
   */
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
      const { company, outcome: companyOutcome } = await this.resolveCompany(tx, lead);
      const { contact, outcome: contactOutcome } = await this.resolveContact(tx, lead, company?.id ?? null);

      const dealName = company?.name ?? contact?.name ?? lead.name;
      const deal =
        pipeline && firstOpenStage
          ? await tx.deal.create({
              data: {
                title: `Oportunidade — ${dealName}`,
                pipelineId: pipeline.id,
                stageId: firstOpenStage.id,
                contactId: contact?.id,
                companyId: company?.id,
                ownerId: lead.responsavelId ?? actingUserId,
              },
            })
          : null;

      const noteContent = `Convertido a partir do lead "${lead.name}"${lead.source ? ` (origem: ${lead.source})` : ""}.`;
      // Na timeline da lead fica o que aconteceu a cada registo (ligado, duplicado encontrado ou criado).
      const parts = [
        company ? `empresa "${company.name}" (${COMPANY_OUTCOME_LABEL[companyOutcome]})` : null,
        contact ? `contacto "${contact.name}" (${CONTACT_OUTCOME_LABEL[contactOutcome]})` : null,
      ].filter(Boolean);
      await tx.timelineEvent.createMany({
        data: [
          ...(contact ? [{ entityType: "CONTACT" as const, entityId: contact.id, type: "SYSTEM" as const, description: noteContent, userId: actingUserId }] : []),
          ...(company ? [{ entityType: "COMPANY" as const, entityId: company.id, type: "SYSTEM" as const, description: noteContent, userId: actingUserId }] : []),
          { entityType: "LEAD", entityId: lead.id, type: "SYSTEM", description: `Convertido: ${parts.join("; ")}.`, userId: actingUserId },
        ],
      });

      // Marcação CONDICIONAL: duas conversões ao mesmo tempo passam ambas a verificação de cima; só uma marca a lead,
      // e a outra falha aqui e desfaz tudo o que criou.
      const marked = await tx.lead.updateMany({
        where: { id, status: { not: "CONVERTIDO" }, convertedDealId: null },
        data: { status: "CONVERTIDO", convertedDealId: deal?.id ?? null, companyId: company?.id ?? null, contactId: contact?.id ?? null },
      });
      if (marked.count !== 1) throw new BadRequestException("Este lead já foi convertido");
      const updatedLead = await tx.lead.findUniqueOrThrow({ where: { id }, include: LEAD_INCLUDE });

      return {
        lead: withoutInternal(updatedLead),
        company,
        contact,
        deal,
        outcome: { company: company ? companyOutcome : null, contact: contact ? contactOutcome : null },
      };
    });
  }

  /** Empresa da conversão: a ligada; senão uma com o mesmo NIF; senão cria (se a lead tiver empresa). */
  private async resolveCompany(tx: Prisma.TransactionClient, lead: Lead): Promise<{ company: Company | null; outcome: ConversionOutcome }> {
    if (lead.companyId) {
      const linked = await tx.company.findUnique({ where: { id: lead.companyId } });
      if (linked) return { company: linked, outcome: "LINKED" };
    }
    const taxId = normalizeTaxId(lead.taxId);
    if (taxId) {
      const [match] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Company" WHERE ${Prisma.raw(TAX_ID_SQL('"taxId"'))} = ${taxId} ORDER BY "createdAt" ASC, "id" ASC LIMIT 1`;
      if (match) return { company: await tx.company.findUniqueOrThrow({ where: { id: match.id } }), outcome: "MATCHED" };
    }
    const name = companyNameOf(lead);
    if (!name) return { company: null, outcome: "CREATED" };
    const isCompanyLead = lead.kind === "COMPANY";
    const company = await tx.company.create({
      data: {
        name,
        taxId: lead.taxId?.trim() || null,
        // Numa lead de empresa o telefone/email são da empresa (e também do contacto principal, se houver).
        phone: isCompanyLead ? lead.phone : null,
        email: isCompanyLead ? lead.email : null,
        ownerId: lead.responsavelId,
      },
    });
    return { company, outcome: "CREATED" };
  }

  /** Contacto da conversão: o ligado; senão um com o mesmo email, ou telefone; senão cria (se a lead tiver pessoa). */
  private async resolveContact(
    tx: Prisma.TransactionClient,
    lead: Lead,
    companyId: string | null,
  ): Promise<{ contact: Contact | null; outcome: ConversionOutcome }> {
    if (lead.contactId) {
      const linked = await tx.contact.findUnique({ where: { id: lead.contactId } });
      if (linked) return { contact: await this.fillCompany(tx, linked, companyId), outcome: "LINKED" };
    }
    if (!hasPerson(lead)) return { contact: null, outcome: "CREATED" };

    const email = lead.email?.trim();
    let match = email
      ? await tx.contact.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })
      : null;
    const phone = normalizePhone(lead.phone);
    if (!match && phone.length >= MIN_PHONE_DIGITS) {
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Contact"
        WHERE ${Prisma.raw(PHONE_SQL('"phone"'))} = ${phone} OR ${Prisma.raw(PHONE_SQL('"mobilePhone"'))} = ${phone}
        ORDER BY "createdAt" ASC, "id" ASC LIMIT 1`;
      if (row) match = await tx.contact.findUniqueOrThrow({ where: { id: row.id } });
    }
    if (match) return { contact: await this.fillCompany(tx, match, companyId), outcome: "MATCHED" };

    const contact = await tx.contact.create({
      data: {
        name: lead.name.trim(),
        email: lead.email,
        phone: lead.phone,
        jobTitle: lead.jobTitle,
        companyId,
        ownerId: lead.responsavelId,
      },
    });
    return { contact, outcome: "CREATED" };
  }

  /** Um contacto que já existia só ganha empresa se não tiver nenhuma; com outra empresa, fica como está. */
  private async fillCompany(tx: Prisma.TransactionClient, contact: Contact, companyId: string | null) {
    if (contact.companyId || !companyId) return contact;
    return tx.contact.update({ where: { id: contact.id }, data: { companyId } });
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.lead.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Lead não encontrado");
  }
}
