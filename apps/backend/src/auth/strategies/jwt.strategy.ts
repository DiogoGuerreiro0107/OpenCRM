import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UsersService } from "../../users/users.service";

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>("JWT_SECRET"),
    });
  }

  /**
   * O papel e o estado vêm da base de dados em cada pedido, NÃO do token: assim desativar alguém ou mudar-lhe
   * o papel tem efeito imediato, em vez de só ao fim da validade do token (15 min).
   */
  async validate(payload: JwtPayload) {
    const user = await this.usersService.findAuthContext(payload.sub);
    if (!user || !user.active) throw new UnauthorizedException();
    return { userId: user.id, email: user.email, role: user.role };
  }
}
