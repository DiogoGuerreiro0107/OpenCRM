import { BadRequestException, ConflictException, Injectable, NotFoundException, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { DEFAULT_WORK_ITEM_TYPE, ensureSystemWorkItemTypes, workItemTypeIdFor } from "./system-types";
import { CreateWorkItemTypeDto, UpdateWorkItemTypeDto } from "./dto/work-item-type.dto";

/** Tipos de item de trabalho (Fase 2a). Regras em docs/plano-fase-2-itens-de-trabalho.md. */
@Injectable()
export class WorkItemTypesService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await ensureSystemWorkItemTypes(this.prisma);
  }

  /** Lista completa (configuração curta), pela ordem definida, com o número de itens de cada tipo. */
  async findAll(activeOnly: boolean) {
    const [types, counts] = await Promise.all([
      this.prisma.workItemType.findMany({
        where: activeOnly ? { active: true } : undefined,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      this.prisma.workItem.groupBy({ by: ["typeId"], _count: { _all: true } }),
    ]);
    const countOf = new Map(counts.map((c) => [c.typeId, c._count._all]));
    return types.map((t) => ({ ...t, isDefault: t.id === DEFAULT_WORK_ITEM_TYPE, itemCount: countOf.get(t.id) ?? 0 }));
  }

  async create(dto: CreateWorkItemTypeDto) {
    const name = dto.name.trim();
    const existing = await this.prisma.workItemType.findMany({ select: { id: true, sortOrder: true } });
    const id = workItemTypeIdFor(name, new Set(existing.map((t) => t.id)));
    const sortOrder = existing.reduce((max, t) => Math.max(max, t.sortOrder), -1) + 1;
    return this.prisma.workItemType.create({ data: { id, name, icon: dto.icon, color: dto.color, sortOrder } });
  }

  async update(id: string, dto: UpdateWorkItemTypeDto) {
    await this.findOrThrow(id);
    if (dto.active === false && id === DEFAULT_WORK_ITEM_TYPE) {
      throw new BadRequestException("O tipo por omissão («Tarefa») não pode ser desativado");
    }
    return this.prisma.workItemType.update({
      where: { id },
      data: { name: dto.name?.trim(), icon: dto.icon, color: dto.color, active: dto.active },
    });
  }

  async remove(id: string) {
    const type = await this.findOrThrow(id);
    if (type.isSystem) throw new BadRequestException(`«${type.name}» é um tipo do sistema: podes desativá-lo, mas não apagá-lo`);
    const items = await this.prisma.workItem.count({ where: { typeId: id } });
    if (items > 0) {
      throw new ConflictException(`«${type.name}» tem ${items} tarefa(s): desativa-o em vez de o apagar`);
    }
    // Uma tarefa criada entre a contagem e o apagar faz falhar a chave estrangeira (Restrict): nada se perde.
    await this.prisma.workItemType.delete({ where: { id } });
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
   * Confirma que um item pode ficar com este tipo. Um tipo desativado é recusado em itens novos ou que mudam de tipo,
   * e aceite em itens que já o têm (`currentTypeId`).
   */
  async assertUsable(typeId: string, currentTypeId?: string) {
    if (typeId === currentTypeId) return;
    const type = await this.prisma.workItemType.findUnique({ where: { id: typeId }, select: { active: true, name: true } });
    if (!type) throw new BadRequestException("Tipo de tarefa desconhecido");
    if (!type.active) throw new BadRequestException(`O tipo «${type.name}» está desativado`);
  }

  private async findOrThrow(id: string) {
    const type = await this.prisma.workItemType.findUnique({ where: { id } });
    if (!type) throw new NotFoundException("Tipo de tarefa não encontrado");
    return type;
  }
}
