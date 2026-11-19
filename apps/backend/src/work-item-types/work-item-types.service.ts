import { BadRequestException, ConflictException, Injectable, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { WorkflowStepCategory } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { statusForCategory } from "../tasks/work-item-status";
import { DEFAULT_WORK_ITEM_TYPE, ensureSystemWorkItemTypes, workItemTypeIdFor } from "./system-types";
import { CreateWorkItemTypeDto, UpdateWorkItemTypeDto } from "./dto/work-item-type.dto";

/** Passos com que um tipo fica ao «dar passos» (Fase 2b): um por categoria, para todo o estado ter onde ficar. */
export const DEFAULT_WORK_ITEM_STEPS: Array<{ name: string; category: WorkflowStepCategory }> = [
  { name: "Por fazer", category: "OPEN" },
  { name: "Em curso", category: "IN_PROGRESS" },
  { name: "Concluída", category: "DONE" },
  { name: "Cancelada", category: "CANCELLED" },
];

const STEPS_SELECT = { steps: { orderBy: { order: "asc" as const }, select: { id: true, name: true, order: true, category: true } } };

/** Tipos de item de trabalho (Fase 2a; passos na 2b). Regras em docs/plano-fase-2-itens-de-trabalho.md. */
@Injectable()
export class WorkItemTypesService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await ensureSystemWorkItemTypes(this.prisma);
  }

  /** Lista completa (configuração curta), pela ordem definida, com o número de itens e os passos de cada tipo. */
  async findAll(activeOnly: boolean) {
    const [types, counts] = await Promise.all([
      this.prisma.workItemType.findMany({
        where: activeOnly ? { active: true } : undefined,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: { workflow: { select: STEPS_SELECT } },
      }),
      this.prisma.workItem.groupBy({ by: ["typeId"], _count: { _all: true } }),
    ]);
    const countOf = new Map(counts.map((c) => [c.typeId, c._count._all]));
    return types.map(({ workflow, ...t }) => ({
      ...t,
      steps: workflow?.steps ?? [],
      isDefault: t.id === DEFAULT_WORK_ITEM_TYPE,
      itemCount: countOf.get(t.id) ?? 0,
    }));
  }

  async create(dto: CreateWorkItemTypeDto) {
    const name = dto.name.trim();
    const existing = await this.prisma.workItemType.findMany({ select: { id: true, sortOrder: true } });
    const id = workItemTypeIdFor(name, new Set(existing.map((t) => t.id)));
    const sortOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder), -1) + 1;
    return this.prisma.workItemType.create({ data: { id, name, icon: dto.icon, color: dto.color, sortOrder } });
  }

  async update(id: string, dto: UpdateWorkItemTypeDto) {
    const type = await this.findOrThrow(id);
    if (dto.active === false && id === DEFAULT_WORK_ITEM_TYPE) {
      throw new BadRequestException("O tipo por omissão («Tarefa») não pode ser desativado");
    }
    const name = dto.name?.trim();
    return this.prisma.$transaction(async (tx) => {
      // O fluxo tem o nome do tipo (só aparece na auditoria e nas rotas genéricas): acompanha a mudança de nome.
      if (name && type.workflowId) await tx.workflow.update({ where: { id: type.workflowId }, data: { name } });
      return tx.workItemType.update({ where: { id }, data: { name, icon: dto.icon, color: dto.color, active: dto.active } });
    });
  }

  /** Apaga um tipo sem itens, com o seu fluxo e os seus campos personalizados. */
  async remove(id: string) {
    const type = await this.findOrThrow(id);
    if (type.isSystem) throw new BadRequestException(`«${type.name}» é um tipo do sistema: podes desativá-lo, mas não apagá-lo`);
    const items = await this.prisma.workItem.count({ where: { typeId: id } });
    if (items > 0) {
      throw new ConflictException(`«${type.name}» tem ${items} tarefa(s): desativa-o em vez de o apagar`);
    }
    // Uma tarefa criada entre a contagem e o apagar faz falhar a chave estrangeira (Restrict): nada se perde.
    await this.prisma.$transaction(async (tx) => {
      await tx.workItemType.delete({ where: { id } });
      if (type.workflowId) await tx.workflow.delete({ where: { id: type.workflowId } });
      await tx.customField.deleteMany({ where: { entityType: "WORK_ITEM", scopeId: id } });
    });
    return { id };
  }

  /** Nova ordem: tem de trazer todos os tipos, cada um uma vez. */
  async reorder(ids: string[]) {
    const all = await this.prisma.workItemType.findMany({ select: { id: true } });
    const known = new Set(all.map((t) => t.id));
    if (new Set(ids).size !== ids.length || ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new BadRequestException("A nova ordem tem de incluir todos os tipos, uma vez cada");
    }
    await this.prisma.$transaction(ids.map((id, sortOrder) => this.prisma.workItemType.update({ where: { id }, data: { sortOrder } })));
    return this.findAll(false);
  }

  /**
   * Dá passos a um tipo: cria o fluxo com os passos por omissão e põe cada item no passo da categoria do seu estado
   * (nenhum estado muda). Tudo numa transação; quem criar ou mudar um item deste tipo ao mesmo tempo espera por ela
   * (o trigger lê o tipo com FOR SHARE).
   */
  async addWorkflow(id: string) {
    const type = await this.findOrThrow(id);
    if (type.workflowId) throw new ConflictException(`«${type.name}» já tem passos`);
    await this.prisma.$transaction(async (tx) => {
      const workflow = await tx.workflow.create({
        data: { entityType: "WORK_ITEM", name: type.name, steps: { create: DEFAULT_WORK_ITEM_STEPS.map((s, order) => ({ ...s, order })) } },
        include: { steps: true },
      });
      // Condicional: se outro pedido deu passos entretanto, nenhuma linha muda e a transação desfaz-se.
      const claimed = await tx.workItemType.updateMany({ where: { id, workflowId: null }, data: { workflowId: workflow.id } });
      if (claimed.count !== 1) throw new ConflictException(`«${type.name}» já tem passos`);
      for (const step of workflow.steps) {
        await tx.workItem.updateMany({ where: { typeId: id, status: statusForCategory(step.category) }, data: { stepId: step.id } });
      }
    });
    return this.findOneView(id);
  }

  /** Tira os passos a um tipo: os itens ficam sem passo e mantêm o estado; o fluxo é apagado. */
  async removeWorkflow(id: string) {
    const type = await this.findOrThrow(id);
    if (!type.workflowId) throw new BadRequestException(`«${type.name}» não tem passos`);
    const workflowId = type.workflowId;
    await this.prisma.$transaction(async (tx) => {
      // Primeiro o tipo (bloqueia a linha: quem mexer em itens deste tipo espera), depois os itens, por fim o fluxo.
      const released = await tx.workItemType.updateMany({ where: { id, workflowId }, data: { workflowId: null } });
      if (released.count !== 1) throw new ConflictException(`Os passos de «${type.name}» mudaram entretanto; tenta de novo`);
      await tx.workItem.updateMany({ where: { typeId: id }, data: { stepId: null } });
      await tx.workflow.delete({ where: { id: workflowId } });
    });
    return this.findOneView(id);
  }

  /**
   * Confirma que um item pode ficar com este tipo. Um tipo desativado é recusado em itens novos ou que mudam de tipo,
   * e aceite em itens que já o têm (`currentTypeId`).
   */
  async assertUsable(typeId: string, currentTypeId?: string) {
    if (typeId === currentTypeId) return;
    const type = await this.prisma.workItemType.findUnique({ where: { id: typeId }, select: { active: true, name: true } });
    if (!type) throw new BadRequestException("Tipo de tarefa desconhecido");
    if (!type.active) throw new BadRequestException(`O tipo «${type.name}» está desativado`);
  }

  private async findOneView(id: string) {
    return (await this.findAll(false)).find((t) => t.id === id)!;
  }

  private async findOrThrow(id: string) {
    const type = await this.prisma.workItemType.findUnique({ where: { id } });
    if (!type) throw new NotFoundException("Tipo de tarefa não encontrado");
    return type;
  }
}
