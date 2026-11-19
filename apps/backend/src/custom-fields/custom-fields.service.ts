import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { PermissionsService } from "../auth/permissions.service";
import { CreateCustomFieldDto } from "./dto/create-custom-field.dto";
import { UpdateCustomFieldDto } from "./dto/update-custom-field.dto";
import { QueryCustomFieldsDto } from "./dto/query-custom-fields.dto";
import { UpsertCustomFieldValuesDto } from "./dto/upsert-custom-field-values.dto";
import { CUSTOM_FIELD_ENTITIES, CustomFieldEntity, CustomFieldEntityType } from "./entity-registry";
import { fromValueColumns, toValueColumns } from "./custom-field-values";

function slugify(label: string) {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Tipo de registo de um módulo desligado = como se não existisse (404), tal como as rotas do módulo. */
  private entity(entityType: CustomFieldEntityType): CustomFieldEntity {
    const entity = CUSTOM_FIELD_ENTITIES[entityType];
    if (entity.module && !this.modules.isEnabled(entity.module)) throw new NotFoundException();
    return entity;
  }

  findAll(query: QueryCustomFieldsDto) {
    this.entity(query.entityType);
    return this.prisma.customField.findMany({
      where: { entityType: query.entityType },
      orderBy: { sortOrder: "asc" },
    });
  }

  async create(dto: CreateCustomFieldDto) {
    const entity = this.entity(dto.entityType);
    const fieldName = dto.fieldName ? slugify(dto.fieldName) : slugify(dto.fieldLabel);
    if (!fieldName) throw new BadRequestException("Nome do campo inválido");

    const scopeId = dto.scopeId?.trim() ?? "";
    if (scopeId) {
      if (!entity.scopes) throw new BadRequestException(`Os campos de ${entity.label.toLowerCase()} não têm âmbito`);
      if (!(await entity.scopes.isValid(this.prisma, scopeId))) throw new BadRequestException(`O ${entity.scopes.label} indicado não existe`);
    }

    // Um nome não se repete entre campos que se aplicam aos mesmos registos: um campo de todos ("") colide com os de
    // qualquer âmbito, e um de um âmbito com os de todos e os desse âmbito.
    const existing = await this.prisma.customField.findFirst({
      where: { entityType: dto.entityType, fieldName, ...(scopeId ? { scopeId: { in: ["", scopeId] } } : {}) },
    });
    if (existing) throw new BadRequestException("Já existe um campo com este nome para esta entidade");

    return this.prisma.customField.create({
      data: { ...dto, scopeId, fieldName, options: dto.options as Prisma.InputJsonValue },
    });
  }

  /** Âmbitos cujos campos se aplicam a um registo: todos ("") e, nos tipos com âmbitos, o do registo. */
  private async scopesOf(entityType: CustomFieldEntityType, entityId: string) {
    const scopes = (CUSTOM_FIELD_ENTITIES[entityType] as CustomFieldEntity).scopes;
    if (!scopes) return [""];
    const scope = await scopes.of(this.prisma, entityId);
    return scope ? ["", scope] : [""];
  }

  async update(id: string, dto: UpdateCustomFieldDto) {
    const field = await this.prisma.customField.findUnique({ where: { id } });
    if (!field) throw new NotFoundException("Campo personalizado não encontrado");

    // Mudar o tipo com valores guardados deixá-los-ia na coluna errada (ilegíveis).
    if (dto.fieldType && dto.fieldType !== field.fieldType) {
      const count = await this.prisma.customFieldValue.count({ where: { customFieldId: id } });
      if (count > 0) {
        throw new BadRequestException(
          `Não é possível mudar o tipo de um campo que já tem ${count} valor(es) preenchido(s). Cria um campo novo, ou apaga os valores primeiro.`,
        );
      }
    }

    return this.prisma.customField.update({
      where: { id },
      data: { ...dto, options: dto.options as Prisma.InputJsonValue | undefined },
    });
  }

  async remove(id: string) {
    const exists = await this.prisma.customField.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Campo personalizado não encontrado");
    await this.prisma.customField.delete({ where: { id } });
  }

  async getValues(entityType: CustomFieldEntityType, entityId: string) {
    this.entity(entityType);
    const scopeIds = await this.scopesOf(entityType, entityId);
    const values = await this.prisma.customFieldValue.findMany({
      // Só os campos deste tipo de registo (um valor gravado por engano noutro tipo, antes da 0b, não aparece) e que
      // se aplicam a ele (numa tarefa que mudou de tipo, os valores dos campos do tipo antigo ficam guardados, ocultos).
      where: { entityType, entityId, customField: { entityType, scopeId: { in: scopeIds } } },
      include: { customField: true },
    });
    return values.map((v) => ({ customFieldId: v.customFieldId, value: fromValueColumns(v.customField.fieldType, v) }));
  }

  /**
   * Grava valores. Exige: poder editar ESTE tipo de registo (a mesma regra que a edição do próprio registo), que o
   * registo exista, que cada campo pertença a este tipo de registo e que cada valor sirva para o tipo do campo.
   * Tudo ou nada: um valor inválido não grava nenhum.
   */
  async upsertValues(dto: UpsertCustomFieldValuesDto, user: { role: Role }) {
    const entity = this.entity(dto.entityType);
    if (!this.permissions.canWrite(user.role, entity.writeArea)) {
      throw new ForbiddenException(`Sem permissão para alterar campos personalizados de ${entity.label.toLowerCase()}`);
    }
    if (!(await entity.exists(this.prisma, dto.entityId))) throw new NotFoundException("Registo não encontrado");

    const fieldIds = dto.values.map((v) => v.customFieldId);
    if (new Set(fieldIds).size !== fieldIds.length) throw new BadRequestException("O mesmo campo aparece mais de uma vez");
    const fields = await this.prisma.customField.findMany({ where: { id: { in: fieldIds } } });
    const fieldById = new Map(fields.map((f) => [f.id, f]));
    const scopeIds = await this.scopesOf(dto.entityType, dto.entityId);

    // Valida TUDO antes de gravar o que quer que seja.
    const writes = dto.values.map(({ customFieldId, value }) => {
      const field = fieldById.get(customFieldId);
      if (!field) throw new NotFoundException(`Campo personalizado ${customFieldId} não encontrado`);
      if (field.entityType !== dto.entityType) {
        throw new BadRequestException(`O campo «${field.fieldLabel}» não pertence a ${entity.label.toLowerCase()}`);
      }
      if (!scopeIds.includes(field.scopeId)) {
        throw new BadRequestException(`O campo «${field.fieldLabel}» não se aplica a este ${entity.scopes?.label ?? "registo"}`);
      }
      return { customFieldId, data: toValueColumns(field, value) };
    });

    await this.prisma.$transaction(
      writes.map(({ customFieldId, data }) =>
        this.prisma.customFieldValue.upsert({
          where: { customFieldId_entityId: { customFieldId, entityId: dto.entityId } },
          update: data,
          create: { customFieldId, entityType: dto.entityType, entityId: dto.entityId, ...data },
        }),
      ),
    );

    return this.getValues(dto.entityType, dto.entityId);
  }
}
