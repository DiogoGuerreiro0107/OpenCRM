import { Injectable } from "@nestjs/common";
import type { Server } from "socket.io";

/** Nome do único evento enviado aos browsers. */
export const REALTIME_EVENT = "crm:event";

/**
 * Ponto único para avisar os browsers ligados de que algo mudou.
 *
 * O evento NUNCA leva dados de negócio — só `{ resource, action }` ("mudou alguma coisa em deals"). O browser,
 * ao receber, refaz o pedido HTTP normal, que continua sujeito aos guards e às permissões. Assim o WebSocket não
 * é um segundo caminho de leitura e não pode vazar nada que a API não deixasse ver.
 */
@Injectable()
export class RealtimeService {
  private server?: Server;

  attach(server: Server) {
    this.server = server;
  }

  emit(resource: string, action: string) {
    this.server?.emit(REALTIME_EVENT, { resource, action });
  }

  /** Fecha as ligações de um utilizador (ex.: quando é desativado). */
  disconnectUser(userId: string) {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }
}

export const userRoom = (userId: string) => `user:${userId}`;
