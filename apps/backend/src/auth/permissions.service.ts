import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { isWriteArea, WRITE_AREA_KEYS, WRITE_AREAS, WriteArea } from "./permissions";

/** Papéis que nunca escrevem, seja qual for a configuração. */
const NEVER_WRITES: Role[] = ["LEITURA_APENAS"];
const ALWAYS_WRITES: Role = "ADMINISTRADOR";

const ROLE_ORDER = Object.values(Role);
const normalize = (roles: Role[]) => ROLE_ORDER.filter((r) => roles.includes(r));

/**
 * Permissões de escrita configuráveis (Fase 0d). Fonte única para o `RolesGuard` (rotas com @WriteArea) e para os
 * serviços. Cache em memória (uma só instância do backend), atualizada em cada alteração.
 */
@Injectable()
export class PermissionsService implements OnModuleInit {
  private overrides = new Map<WriteArea, Role[]>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.reload();
  }

  /** Relê a configuração da base de dados (arranque, testes). Linhas de áreas que já não existem são ignoradas. */
  async reload() {
    const rows = await this.prisma.permissionSetting.findMany();
    this.overrides = new Map(rows.filter((r) => isWriteArea(r.area)).map((r) => [r.area as WriteArea, r.roles]));
  }

  rolesFor(area: WriteArea): Role[] {
    return this.overrides.get(area) ?? WRITE_AREAS[area].defaultRoles;
  }

  canWrite(role: Role | undefined, area: WriteArea): boolean {
    return !!role && this.rolesFor(area).includes(role);
  }

  /** Áreas em que este papel pode escrever (para o frontend mostrar/esconder botões). */
  writeAreasFor(role: Role): WriteArea[] {
    return WRITE_AREA_KEYS.filter((area) => this.canWrite(role, area));
  }

  list() {
    return WRITE_AREA_KEYS.map((area) => {
      const roles = this.rolesFor(area);
      const defaults = WRITE_AREAS[area].defaultRoles;
      return {
        area,
        label: WRITE_AREAS[area].label,
        description: WRITE_AREAS[area].description,
        roles: normalize(roles),
        defaultRoles: normalize(defaults),
        isDefault: !this.overrides.has(area),
      };
    });
  }

  private assertArea(area: string): asserts area is WriteArea {
    if (!isWriteArea(area)) throw new NotFoundException("Área de permissões não encontrada");
  }

  /** Define os papéis de uma área. O Administrador é sempre incluído; Leitura apenas nunca pode ser. */
  async set(area: string, roles: Role[]) {
    this.assertArea(area);
    const invalid = roles.filter((r) => NEVER_WRITES.includes(r));
    if (invalid.length > 0) throw new BadRequestException("O papel Leitura apenas não pode ter permissões de escrita");
    if (!roles.includes(ALWAYS_WRITES)) {
      throw new BadRequestException("O Administrador tem sempre permissão de escrita (não pode ser retirado)");
    }
    const value = normalize([...new Set(roles)]);
    await this.prisma.permissionSetting.upsert({ where: { area }, update: { roles: value }, create: { area, roles: value } });
    await this.reload();
    return this.list();
  }

  /** Volta à predefinição (apaga a configuração da área). */
  async reset(area: string) {
    this.assertArea(area);
    await this.prisma.permissionSetting.deleteMany({ where: { area } });
    await this.reload();
    return this.list();
  }
}
