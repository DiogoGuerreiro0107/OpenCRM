import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { RealtimeService } from "../realtime/realtime.service";

/** Campos que podem sair para a API. NUNCA passwordHash, refreshToken nem resetToken. */
const MANAGED_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  createdAt: true,
} as const;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** Estado atual do utilizador, lido em cada pedido autenticado (papel e estado nunca vêm só do token). */
  findAuthContext(id: string) {
    return this.prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, active: true } });
  }

  /** Para dropdowns (responsável, atribuído a…): só utilizadores ativos. */
  findAllSummary() {
    return this.prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    });
  }

  findAllManaged() {
    return this.prisma.user.findMany({ select: MANAGED_USER_SELECT, orderBy: { name: "asc" } });
  }

  async createUser(dto: CreateUserDto) {
    try {
      return await this.prisma.user.create({
        data: {
          name: dto.name.trim(),
          email: normalizeEmail(dto.email),
          role: dto.role,
          passwordHash: await bcrypt.hash(dto.password, 10),
        },
        select: MANAGED_USER_SELECT,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("Já existe um utilizador com este email");
      }
      throw err;
    }
  }

  async updateUser(actingUserId: string, id: string, dto: UpdateUserDto) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException("Utilizador não encontrado");

    const deactivating = dto.active === false && target.active;
    const changingRole = dto.role !== undefined && dto.role !== target.role;

    if (id === actingUserId && (deactivating || changingRole)) {
      throw new BadRequestException("Não podes desativar a tua própria conta nem alterar o teu próprio papel");
    }

    const losesAdminRights = target.role === "ADMINISTRADOR" && target.active && (deactivating || changingRole);
    if (losesAdminRights) {
      const otherActiveAdmins = await this.prisma.user.count({
        where: { role: "ADMINISTRADOR", active: true, id: { not: id } },
      });
      if (otherActiveAdmins === 0) {
        throw new BadRequestException("Tem de existir pelo menos um Administrador ativo");
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        role: dto.role,
        active: dto.active,
        // Desativar termina a sessão: o refresh token deixa de servir (o de acesso é recusado em cada pedido).
        ...(deactivating ? { refreshToken: null } : {}),
      },
      select: MANAGED_USER_SELECT,
    });

    // Um utilizador desativado deixa de receber eventos em tempo real: fecha-lhe as ligações abertas.
    if (deactivating) this.realtime.disconnectUser(id);
    return updated;
  }

  /** O Administrador define uma password nova a outro utilizador; as sessões desse utilizador terminam. */
  async setPasswordByAdmin(id: string, newPassword: string) {
    const exists = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Utilizador não encontrado");
    await this.updatePassword(id, await bcrypt.hash(newPassword, 10));
  }

  create(data: { email: string; name: string; passwordHash: string; role?: Role }) {
    return this.prisma.user.create({ data });
  }

  setRefreshToken(id: string, refreshToken: string | null) {
    return this.prisma.user.update({ where: { id }, data: { refreshToken } });
  }

  findByResetToken(token: string) {
    return this.prisma.user.findUnique({ where: { resetToken: token } });
  }

  setResetToken(id: string, resetToken: string | null, resetTokenExpiresAt: Date | null) {
    return this.prisma.user.update({ where: { id }, data: { resetToken, resetTokenExpiresAt } });
  }

  updatePassword(id: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash, resetToken: null, resetTokenExpiresAt: null, refreshToken: null },
    });
  }
}
