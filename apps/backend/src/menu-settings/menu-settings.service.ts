import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MenuEntryDto } from "./menu-settings.dto";

const ROW = "default";

/**
 * Preferências do menu principal (Fase 2c, docs/plano-fase-2-itens-de-trabalho.md). O servidor guarda só a lista
 * ordenada de entradas; quais itens existem (e quem os vê) é decidido no frontend, e cada rota continua protegida aqui.
 */
@Injectable()
export class MenuSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sem preferências gravadas: lista vazia (o frontend mostra o menu por omissão). */
  async get() {
    const row = await this.prisma.menuSetting.findUnique({ where: { id: ROW } });
    return { entries: (row?.entries ?? []) as unknown as MenuEntryDto[], updatedAt: row?.updatedAt ?? null };
  }

  async update(entries: MenuEntryDto[]) {
    const ids = entries.map((e) => e.id);
    const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (repeated.length > 0) throw new BadRequestException(`Entradas repetidas no menu: ${[...new Set(repeated)].join(", ")}`);
    // Só os campos conhecidos, normalizados (nada de propriedades soltas no JSON guardado).
    const clean = entries.map((e) =>
      e.type === "group"
        ? { type: "group", id: e.id, label: e.label!.trim() }
        : { type: "item", id: e.id, ...(e.label !== undefined ? { label: e.label.trim() } : {}), ...(e.hidden ? { hidden: true } : {}) },
    );
    const value = clean as unknown as Prisma.InputJsonValue;
    await this.prisma.menuSetting.upsert({ where: { id: ROW }, update: { entries: value }, create: { id: ROW, entries: value } });
    return this.get();
  }
}
