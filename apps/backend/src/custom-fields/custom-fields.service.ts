import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { CustomField, CustomFieldType, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCustomFieldDto } from "./dto/create-custom-field.dto";
import { UpdateCustomFieldDto } from "./dto/update-custom-field.dto";
import { QueryCustomFieldsDto } from "./dto/query-custom-fields.dto";
import { UpsertCustomFieldValuesDto } from "./dto/upsert-custom-field-values.dto";

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
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: QueryCustomFieldsDto) {
    return this.prisma.customField.findMany({
      where: { entityType: query.entityType },
      orderBy: { sortOrder: "asc" },
    });
  }

  async create(dto: CreateCustomFieldDto) {
    const fieldName = dto.fieldName ? slugify(dto.fieldName) : slugify(dto.fieldLabel);
    if (!fieldName) throw new BadRequestException("Nome do campo inválido");

    const existing = await this.prisma.customField.findUnique({
      where: { entityType_fieldName: { entityType: dto.entityType, fieldName } },
    });
    if (existing) throw new BadRequestException("Já existe um campo com este nome para esta entidade");

    return this.prisma.customField.create({
      data: { ...dto, fieldName, options: dto.options as Prisma.InputJsonValue },
    });
  }

  async update(id: string, dto: UpdateCustomFieldDto) {
    await this.ensureExists(id);
    return this.prisma.customField.update({
      where: { id },
      data: { ...dto, options: dto.options as Prisma.InputJsonValue | undefined },
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.customField.delete({ where: { id } });
  }

  async getValues(entityType: QueryCustomFieldsDto["entityType"], entityId: string) {
    const values = await this.prisma.customFieldValue.findMany({
      where: { entityType, entityId },
      include: { customField: true },
    });
    return values.map((v) => ({ customFieldId: v.customFieldId, value: extractValue(v.customField.fieldType, v) }));
  }

  async upsertValues(dto: UpsertCustomFieldValuesDto) {
    const fieldIds = dto.values.map((v) => v.customFieldId);
    const fields = await this.prisma.customField.findMany({ where: { id: { in: fieldIds } } });
    const fieldById = new Map(fields.map((f) => [f.id, f]));

    await this.prisma.$transaction(
      dto.values.map(({ customFieldId, value }) => {
        const field = fieldById.get(customFieldId);
        if (!field) throw new NotFoundException(`Campo personalizado ${customFieldId} não encontrado`);
        const data = buildValueColumns(field.fieldType, value);

        return this.prisma.customFieldValue.upsert({
          where: { customFieldId_entityId: { customFieldId, entityId: dto.entityId } },
          update: data,
          create: { customFieldId, entityType: dto.entityType, entityId: dto.entityId, ...data },
        });
      }),
    );

    return this.getValues(dto.entityType, dto.entityId);
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.customField.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Campo personalizado não encontrado");
  }
}

interface ValueColumns {
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueBoolean: boolean | null;
  valueJson: Prisma.InputJsonValue | typeof Prisma.JsonNull;
}

function buildValueColumns(fieldType: CustomFieldType, value: unknown): ValueColumns {
  const empty: ValueColumns = {
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueBoolean: null,
    valueJson: Prisma.JsonNull,
  };
  if (value === null || value === undefined || value === "") return empty;

  switch (fieldType) {
    case "NUMBER":
    case "CURRENCY":
      return { ...empty, valueNumber: Number(value) };
    case "DATE":
      return { ...empty, valueDate: new Date(value as string) };
    case "BOOLEAN":
      return { ...empty, valueBoolean: Boolean(value) };
    case "MULTISELECT":
      return { ...empty, valueJson: value as Prisma.InputJsonValue };
    default:
      return { ...empty, valueText: String(value) };
  }
}

function extractValue(fieldType: CustomFieldType, row: { valueText: string | null; valueNumber: number | null; valueDate: Date | null; valueBoolean: boolean | null; valueJson: Prisma.JsonValue | null }) {
  switch (fieldType) {
    case "NUMBER":
    case "CURRENCY":
      return row.valueNumber;
    case "DATE":
      return row.valueDate;
    case "BOOLEAN":
      return row.valueBoolean;
    case "MULTISELECT":
      return row.valueJson;
    default:
      return row.valueText;
  }
}
