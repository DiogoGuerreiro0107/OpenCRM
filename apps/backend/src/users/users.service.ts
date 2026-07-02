import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Role } from "@prisma/client";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findAllSummary() {
    return this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    });
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
