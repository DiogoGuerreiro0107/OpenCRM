import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateCarrierDto, UpdateCarrierDto } from "./dto/order.dto";

/** Nome sem maiúsculas nem espaços nas pontas: «CTT» e « ctt » são a mesma transportadora. */
const keyOf = (name: string) => name.trim().toLocaleLowerCase("pt-PT");

export const TRACKING_PLACEHOLDER = "{codigo}";

/** O problema do link de seguimento, ou null se serve: http(s) e com `{codigo}`. */
export function trackingTemplateProblem(template: string): string | null {
  if (!template.includes(TRACKING_PLACEHOLDER)) return `O link tem de ter ${TRACKING_PLACEHOLDER} no sítio do código`;
  let url: URL;
  try {
    url = new URL(template.split(TRACKING_PLACEHOLDER).join("X"));
  } catch {
    return "Link inválido";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "O link tem de começar por http:// ou https://";
  return null;
}

/** Link de seguimento de uma expedição: o da transportadora com o código (codificado). Sem um dos dois, não há. */
export function trackingUrl(template: string | null | undefined, code: string | null | undefined): string | null {
  if (!template || !code) return null;
  return template.split(TRACKING_PLACEHOLDER).join(encodeURIComponent(code));
}

/**
 * Transportadoras (Fase 6d, docs/plano-fase-6-encomendas.md): lista curta de configuração (vem inteira). Com
 * expedições, desativa-se em vez de apagar.
 */
@Injectable()
export class CarriersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const carriers = await this.prisma.carrier.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { shipments: true } } } });
    return carriers.map(({ _count, ...c }) => ({ ...c, shipmentCount: _count.shipments }));
  }

  async create(dto: CreateCarrierDto) {
    const template = this.template(dto.trackingUrlTemplate);
    return this.write(() =>
      this.prisma.carrier.create({ data: { name: dto.name.trim(), nameKey: keyOf(dto.name), trackingUrlTemplate: template ?? null, sortOrder: dto.sortOrder, active: dto.active } }),
    );
  }

  async update(id: string, dto: UpdateCarrierDto) {
    await this.find(id);
    const template = this.template(dto.trackingUrlTemplate);
    return this.write(() =>
      this.prisma.carrier.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          nameKey: dto.name === undefined ? undefined : keyOf(dto.name),
          trackingUrlTemplate: template,
          sortOrder: dto.sortOrder,
          active: dto.active,
        },
      }),
    );
  }

  async remove(id: string) {
    await this.find(id);
    if ((await this.prisma.shipment.count({ where: { carrierId: id } })) > 0) {
      throw new ConflictException("A transportadora tem expedições: desativa-a em vez de a apagar");
    }
    await this.prisma.carrier.delete({ where: { id } });
  }

  /** `undefined` = não mexer; `null` ou vazio = sem link. */
  private template(value: string | null | undefined) {
    if (value === undefined) return undefined;
    const trimmed = value?.trim() ?? "";
    if (!trimmed) return null;
    const problem = trackingTemplateProblem(trimmed);
    if (problem) throw new BadRequestException(problem);
    return trimmed;
  }

  private async find(id: string) {
    const carrier = await this.prisma.carrier.findUnique({ where: { id } });
    if (!carrier) throw new NotFoundException("Transportadora não encontrada");
    return carrier;
  }

  private async write<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ConflictException("Já existe uma transportadora com esse nome");
      throw err;
    }
  }
}
