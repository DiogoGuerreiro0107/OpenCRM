import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { UsersModule } from "../users/users.module";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeInterceptor } from "./realtime.interceptor";
import { RealtimeService } from "./realtime.service";

/** Global: qualquer serviço pode injetar o RealtimeService para avisar os browsers ligados. */
@Global()
@Module({
  imports: [UsersModule, JwtModule.register({})],
  providers: [RealtimeService, RealtimeGateway, RealtimeInterceptor],
  exports: [RealtimeService],
})
export class RealtimeModule {}
