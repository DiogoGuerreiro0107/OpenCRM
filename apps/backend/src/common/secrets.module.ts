import { Global, Module } from "@nestjs/common";
import { SecretsService } from "./secrets.service";
import { SecretsBootstrap } from "./secrets.bootstrap";

/** Global: qualquer módulo (email, telefonia, e mais tarde chaves de API e extensões) pode cifrar segredos. */
@Global()
@Module({
  providers: [SecretsService, SecretsBootstrap],
  exports: [SecretsService],
})
export class SecretsModule {}
