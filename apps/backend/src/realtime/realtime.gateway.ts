import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { isAllowedOrigin, parseCorsOrigins } from "../common/security";
import { UsersService } from "../users/users.service";
import { RealtimeService, userRoom } from "./realtime.service";

const allowedOrigins = () => parseCorsOrigins(process.env.CORS_ORIGINS);

/**
 * Canal de tempo real. Só recebe ligações autenticadas: o cliente envia o token de acesso no handshake
 * (`auth.token`) e o utilizador é lido na base de dados (tem de existir e estar ativo, tal como no JwtStrategy).
 * Com autenticação por token — e não por cookie — um site malicioso não consegue "pegar" na sessão de ninguém.
 */
@WebSocketGateway({
  cors: {
    // Mesma regra do resto da API (rede local + CORS_ORIGINS). Avaliada em cada ligação, depois do .env carregado.
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) =>
      callback(null, isAllowedOrigin(origin, allowedOrigins())),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);

    server.use(async (socket, next) => {
      // O CORS não protege WebSockets: a origem verifica-se também aqui.
      if (!isAllowedOrigin(socket.handshake.headers.origin, allowedOrigins())) {
        return next(new Error("unauthorized"));
      }

      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || token.length === 0) return next(new Error("unauthorized"));

      try {
        const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
          secret: this.config.get<string>("JWT_SECRET"),
        });
        const user = await this.users.findAuthContext(payload.sub);
        if (!user?.active) return next(new Error("unauthorized"));
        socket.data.userId = user.id;
        next();
      } catch {
        // Mesma mensagem para qualquer falha: não revela porquê (token inválido, expirado, utilizador desativado).
        next(new Error("unauthorized"));
      }
    });
  }

  handleConnection(socket: Socket) {
    if (socket.data.userId) socket.join(userRoom(socket.data.userId));
  }
}
