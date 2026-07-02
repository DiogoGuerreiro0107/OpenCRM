import { BadRequestException, ForbiddenException, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { UsersService } from "../users/users.service";
import { EmailService } from "../email/email.service";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException("Credenciais inválidas");

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException("Credenciais inválidas");

    const tokens = await this.issueTokens(user.id, user.email, user.role);
    await this.usersService.setRefreshToken(user.id, await bcrypt.hash(tokens.refreshToken, 10));

    return {
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  async refresh(userId: string, refreshToken: string) {
    const user = await this.usersService.findById(userId);
    if (!user?.refreshToken) throw new ForbiddenException("Acesso negado");

    const matches = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!matches) throw new ForbiddenException("Acesso negado");

    const tokens = await this.issueTokens(user.id, user.email, user.role);
    await this.usersService.setRefreshToken(user.id, await bcrypt.hash(tokens.refreshToken, 10));
    return tokens;
  }

  async logout(userId: string) {
    await this.usersService.setRefreshToken(userId, null);
  }

  async forgotPassword(email: string) {
    const user = await this.usersService.findByEmail(email);
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      await this.usersService.setResetToken(user.id, token, expiresAt);

      const frontendUrl = this.config.get<string>("FRONTEND_URL") ?? "http://localhost:5173";
      const resetLink = `${frontendUrl}/redefinir-password?token=${token}`;
      try {
        await this.emailService.sendRaw(
          user.email,
          "Recuperação de password — OpenCRM",
          `Olá ${user.name},\n\nRecebemos um pedido para repor a tua password. Usa o link abaixo (válido durante 1 hora):\n\n${resetLink}\n\nSe não pediste isto, ignora este email.`,
        );
      } catch (err) {
        this.logger.warn(`Não foi possível enviar o email de recuperação de password: ${(err as Error).message}`);
      }
    }

    return { message: "Se o email existir, foi enviado um link de recuperação." };
  }

  async resetPassword(token: string, newPassword: string) {
    const user = await this.usersService.findByResetToken(token);
    if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
      throw new BadRequestException("Token inválido ou expirado");
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersService.updatePassword(user.id, passwordHash);
    return { message: "Password redefinida com sucesso" };
  }

  private async issueTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>("JWT_SECRET"),
        expiresIn: this.config.get<string>("JWT_ACCESS_EXPIRES") ?? "15m",
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>("JWT_REFRESH_SECRET"),
        expiresIn: this.config.get<string>("JWT_REFRESH_EXPIRES") ?? "7d",
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
