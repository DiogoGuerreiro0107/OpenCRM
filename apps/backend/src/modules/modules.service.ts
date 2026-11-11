import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MODULE_MANIFESTS, ModuleId, isModuleId, manifestOf } from "./module-manifest";
import { activeDependents, missingDependencies } from "./module-rules";

export interface ModuleView {
  id: ModuleId;
  label: string;
  description: string;
  enabled: boolean;
  dependsOn: ModuleId[];
  /** Módulos ATIVOS que dependem deste (se houver, não pode ser desligado). */
  activeDependents: ModuleId[];
}

const labelOf = (id: ModuleId) => manifestOf(id).label;

/**
 * Estado dos módulos opcionais. Mantido numa cache em memória (há uma só instância do backend) que se atualiza
 * em cada escrita, para que o `ModuleGuard` — que corre em quase todos os pedidos — não consulte a base de dados.
 */
@Injectable()
export class ModulesService implements OnModuleInit {
  private enabled = new Map<ModuleId, boolean>(MODULE_MANIFESTS.map((m) => [m.id, m.defaultEnabled]));

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
  }

  /** (Re)lê as definições guardadas. Módulos sem linha ficam com o valor por omissão do manifesto. */
  async reload() {
    const rows = await this.prisma.moduleSetting.findMany();
    const saved = new Map(rows.map((row) => [row.moduleId, row.enabled]));
    this.enabled = new Map(MODULE_MANIFESTS.map((m) => [m.id, saved.get(m.id) ?? m.defaultEnabled]));
  }

  /** Módulo desconhecido conta como desligado (nunca se abre uma porta por engano). */
  isEnabled(id: string): boolean {
    return isModuleId(id) && this.enabled.get(id) === true;
  }

  enabledIds(): ModuleId[] {
    return MODULE_MANIFESTS.filter((m) => this.enabled.get(m.id)).map((m) => m.id);
  }

  list(): ModuleView[] {
    const enabledSet = new Set(this.enabledIds());
    return MODULE_MANIFESTS.map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      enabled: enabledSet.has(m.id),
      dependsOn: m.dependsOn,
      activeDependents: activeDependents(m.id, enabledSet),
    }));
  }

  async setEnabled(id: string, enabled: boolean): Promise<ModuleView[]> {
    if (!isModuleId(id)) throw new NotFoundException("Módulo não encontrado");
    const enabledSet = new Set(this.enabledIds());

    if (enabled) {
      const missing = missingDependencies(id, enabledSet);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Para ligar "${labelOf(id)}" liga primeiro: ${missing.map(labelOf).join(", ")}.`,
        );
      }
    } else {
      const dependents = activeDependents(id, enabledSet);
      if (dependents.length > 0) {
        throw new BadRequestException(
          `Não é possível desligar "${labelOf(id)}": ${dependents.map(labelOf).join(", ")} depende${dependents.length > 1 ? "m" : ""} dele. Desliga primeiro.`,
        );
      }
    }

    await this.prisma.moduleSetting.upsert({
      where: { moduleId: id },
      update: { enabled },
      create: { moduleId: id, enabled },
    });
    await this.reload();
    return this.list();
  }
}
