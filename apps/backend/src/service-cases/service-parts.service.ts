import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateServicePartDto, UpdateServicePartDto } from "./dto/service-part.dto";

/** No máximo isto por assistência: a lista vem sempre inteira. */
export const MAX_PARTS_PER_CASE = 100;

const INCLUDE = { createdBy: { select: { id: true, name: true } } } as const;

type PartRow = Prisma.ServicePartGetPayload<{ include: typeof INCLUDE }>;

/** «2 × Rolo de alimentação (RM2-5452)»; quantidades à portuguesa (1,5). */
export function partText(part: { quantity: Prisma.Decimal | number; description: string; reference: string | null }) {
  const quantity = Number(part.quantity).toLocaleString("pt-PT", { maximumFractionDigits: 2 });
  return `${quantity} × ${part.description}${part.reference ? ` (${part.reference})` : ""}`;
}

/**
 * Peças usadas numa assistência (Fase 4c, docs/plano-fase-4-assistencias.md). Texto até existirem produtos; cada
 * mudança fica na timeline da assistência. Sem dono: quem tem escrita corrige.
 */
@Injectable()
export class ServicePartsService {
  constructor(private readonly prisma: PrismaService) {}

  private view(part: PartRow) {
    return { ...part, quantity: Number(part.quantity) };
  }

  private async assertCase(serviceCaseId: string) {
    const exists = await this.prisma.serviceCase.findUnique({ where: { workItemId: serviceCaseId }, select: { workItemId: true } });
    if (!exists) throw new NotFoundException("Assistência não encontrada");
  }

  private note(serviceCaseId: string, description: string, actorId: string) {
    return this.prisma.timelineEvent.create({ data: { entityType: "TASK", entityId: serviceCaseId, type: "SYSTEM", description, userId: actorId } });
  }

  async list(serviceCaseId: string) {
    await this.assertCase(serviceCaseId);
    const parts = await this.prisma.servicePart.findMany({ where: { serviceCaseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: INCLUDE });
    return parts.map((p) => this.view(p));
  }

  async create(serviceCaseId: string, dto: CreateServicePartDto, actorId: string) {
    await this.assertCase(serviceCaseId);
    if ((await this.prisma.servicePart.count({ where: { serviceCaseId } })) >= MAX_PARTS_PER_CASE) {
      throw new BadRequestException(`Uma assistência tem no máximo ${MAX_PARTS_PER_CASE} peças`);
    }
    const part = await this.prisma.servicePart.create({
      data: { serviceCaseId, description: dto.description.trim(), reference: dto.reference?.trim() || null, quantity: dto.quantity ?? 1, createdById: actorId },
      include: INCLUDE,
    });
    await this.note(serviceCaseId, `Peça usada: ${partText(part)}`, actorId);
    return this.view(part);
  }

  async update(serviceCaseId: string, partId: string, dto: UpdateServicePartDto, actorId: string) {
    const existing = await this.findPart(serviceCaseId, partId);
    const part = await this.prisma.servicePart.update({
      where: { id: partId },
      data: {
        description: dto.description?.trim(),
        reference: dto.reference === undefined ? undefined : dto.reference?.trim() || null,
        quantity: dto.quantity,
      },
      include: INCLUDE,
    });
    const before = partText(existing);
    const after = partText(part);
    if (before !== after) await this.note(serviceCaseId, `Peça alterada: ${before} → ${after}`, actorId);
    return this.view(part);
  }

  async remove(serviceCaseId: string, partId: string, actorId: string) {
    const existing = await this.findPart(serviceCaseId, partId);
    await this.prisma.servicePart.delete({ where: { id: partId } });
    await this.note(serviceCaseId, `Peça retirada: ${partText(existing)}`, actorId);
  }

  private async findPart(serviceCaseId: string, partId: string) {
    const part = await this.prisma.servicePart.findFirst({ where: { id: partId, serviceCaseId } });
    if (!part) throw new NotFoundException("Peça não encontrada");
    return part;
  }
}
