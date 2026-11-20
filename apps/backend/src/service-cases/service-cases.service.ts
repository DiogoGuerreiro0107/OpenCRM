import { BadRequestException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { SERVICE_CASE_TYPE } from "../work-item-types/system-types";
import { Prisma, WorkflowStepCategory } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { TasksService } from "../tasks/tasks.service";
import { WorkItemTypesService } from "../work-item-types/work-item-types.service";
import { AutomationsService } from "../automations/automations.service";
import { OPEN_WORK_ITEM_STATUSES } from "../tasks/work-item-status";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import { CreateServiceCaseDto, QueryServiceCasesDto, UpdateServiceCaseDto } from "./dto/service-case.dto";

/** Tipo de tarefa das assistências (tipo do sistema desde a Fase 2a). */
export const SERVICE_TYPE = SERVICE_CASE_TYPE;

/** Passos com que o tipo «Assistência» fica quando ainda não tem passos (os do administrador nunca se pisam). */
export const SERVICE_STEPS: Array<{ name: string; category: WorkflowStepCategory }> = [
  { name: "Recebida", category: "OPEN" },
  { name: "Diagnóstico", category: "IN_PROGRESS" },
  { name: "À espera de peças", category: "IN_PROGRESS" },
  { name: "Em reparação", category: "IN_PROGRESS" },
  { name: "Resolvida", category: "DONE" },
  { name: "Sem reparação", category: "CANCELLED" },
];

/** Código legível: AS-0001. */
export const serviceCode = (n: number) => `AS-${String(n).padStart(4, "0")}`;

const INCLUDE = {
  workItem: {
    select: {
      id: true, title: true, status: true, priority: true, dueDate: true, scheduledStart: true, scheduledEnd: true, typeId: true, stepId: true,
      step: { select: { id: true, name: true, category: true } },
      assignee: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true } },
    },
  },
} as const;

/** Mais recentes primeiro. */
const LIST_KEY: KeyField[] = [
  { field: "createdAt", dir: "desc", kind: "date" },
  { field: "workItemId", dir: "desc", kind: "string" },
];

const TEXT_FIELDS = ["diagnosis", "resolution"] as const;
const TEXT_LABELS: Record<(typeof TEXT_FIELDS)[number], { updated: string; cleared: string }> = {
  diagnosis: { updated: "Diagnóstico atualizado", cleared: "Diagnóstico apagado." },
  resolution: { updated: "Resolução atualizada", cleared: "Resolução apagada." },
};

/**
 * Assistências (Fase 4a, docs/plano-fase-4-assistencias.md): dados próprios dos itens de trabalho do tipo
 * «Assistência». A tarefa é criada pelo serviço das tarefas (passo, automações, timeline); aqui ficam o equipamento, o
 * problema, o diagnóstico e a resolução.
 */
@Injectable()
export class ServiceCasesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ServiceCasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly tasks: TasksService,
    private readonly types: WorkItemTypesService,
    private readonly automations: AutomationsService,
  ) {}

  async onApplicationBootstrap() {
    await this.ensureSteps().catch((err: Error) => this.logger.warn(`Passos das assistências: ${err.message}`));
  }

  /** Com o módulo ligado, o tipo «Assistência» sem passos recebe os passos por omissão. */
  async ensureSteps() {
    if (!this.modules.isEnabled("assistencias")) return;
    const type = await this.prisma.workItemType.findUnique({ where: { id: SERVICE_TYPE }, select: { workflowId: true } });
    if (!type || type.workflowId) return;
    await this.types.addWorkflow(SERVICE_TYPE, SERVICE_STEPS).catch((err: { status?: number }) => {
      if (err.status !== 409) throw err; // outro pedido deu-lhe passos entretanto
    });
  }

  private view<T extends { number: number }>(serviceCase: T) {
    return { ...serviceCase, code: serviceCode(serviceCase.number) };
  }

  async findOne(id: string) {
    const serviceCase = await this.prisma.serviceCase.findUnique({ where: { workItemId: id }, include: INCLUDE });
    if (!serviceCase) throw new NotFoundException("Assistência não encontrada");
    return this.view(serviceCase);
  }

  async findPage(query: QueryServiceCasesDto) {
    const workItem: Prisma.WorkItemWhereInput = {};
    if (query.state === "open") workItem.status = { in: OPEN_WORK_ITEM_STATUSES };
    if (query.state === "closed") workItem.status = { notIn: OPEN_WORK_ITEM_STATUSES };
    if (query.stepId) workItem.stepId = query.stepId;
    if (query.assigneeId) workItem.assigneeId = query.assigneeId;
    if (query.companyId) workItem.companyId = query.companyId;
    if (query.contactId) workItem.contactId = query.contactId;
    const where: Prisma.ServiceCaseWhereInput = { workItem };

    const term = query.search?.trim();
    if (term) {
      const contains = { contains: term, mode: "insensitive" as const };
      const number = /^(?:as-?)?0*(\d{1,9})$/i.exec(term);
      where.OR = [
        ...(number ? [{ number: Number(number[1]) }] : []),
        { brand: contains },
        { model: contains },
        { serialNumber: contains },
        { reportedProblem: contains },
        { workItem: { title: contains } },
        { workItem: { company: { name: contains } } },
        { workItem: { contact: { name: contains } } },
      ];
    }
    const page = await readPage(LIST_KEY, query, (after, take) =>
      this.prisma.serviceCase.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(LIST_KEY), take, include: INCLUDE }),
    );
    return { ...page, items: page.items.map((c) => this.view(c)) };
  }

  /** Cria a tarefa (tipo «Assistência») e os dados próprios; as automações do «criado» já os veem. */
  async create(dto: CreateServiceCaseDto, actorId: string) {
    await this.ensureSteps();
    const problem = dto.reportedProblem.trim();
    const title = dto.title?.trim() || (problem.length > 80 ? `${problem.slice(0, 77)}...` : problem);
    const task = await this.tasks.create(
      { title, typeId: SERVICE_TYPE, companyId: dto.companyId, contactId: dto.contactId, assigneeId: dto.assigneeId, dueDate: dto.dueDate, priority: dto.priority },
      actorId,
      undefined,
      async (workItemId) => {
        await this.prisma.serviceCase.create({
          data: {
            workItemId,
            reportedProblem: problem,
            brand: dto.brand?.trim() || null,
            model: dto.model?.trim() || null,
            serialNumber: dto.serialNumber?.trim() || null,
            underWarranty: dto.underWarranty,
          },
        });
      },
    );
    return this.findOne(task.id);
  }

  /** Dados próprios. Diagnóstico e resolução ficam na timeline; garantia e marca avisam as automações. */
  async update(id: string, dto: UpdateServiceCaseDto, actorId: string) {
    const existing = await this.prisma.serviceCase.findUnique({ where: { workItemId: id } });
    if (!existing) throw new NotFoundException("Assistência não encontrada");
    const clean = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
    const data = {
      brand: clean(dto.brand),
      model: clean(dto.model),
      serialNumber: clean(dto.serialNumber),
      underWarranty: dto.underWarranty,
      reportedProblem: dto.reportedProblem?.trim(),
      diagnosis: clean(dto.diagnosis),
      resolution: clean(dto.resolution),
    };
    if (data.reportedProblem === "") throw new BadRequestException("O problema reportado não pode ficar vazio");
    const updated = await this.prisma.serviceCase.update({ where: { workItemId: id }, data });

    const notes = TEXT_FIELDS.filter((f) => data[f] !== undefined && data[f] !== existing[f]).map((f) =>
      updated[f] ? `${TEXT_LABELS[f].updated}: ${updated[f]}` : TEXT_LABELS[f].cleared,
    );
    if (notes.length > 0) {
      await this.prisma.timelineEvent.createMany({ data: notes.map((description) => ({ entityType: "TASK", entityId: id, type: "SYSTEM", description, userId: actorId })) });
    }
    const changedFields = (["underWarranty", "brand"] as const).filter((f) => updated[f] !== existing[f]);
    if (changedFields.length > 0) await this.automations.dispatch({ entityType: "WORK_ITEM", entityId: id, trigger: "FIELD_CHANGED", changedFields: [...changedFields], actorId });
    return this.findOne(id);
  }
}
