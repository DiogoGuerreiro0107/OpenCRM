import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { countPlaintextSecrets } from "./secrets-migration";

/**
 * Na arrancada, avisa se ainda há segredos em claro na base de dados (instalações anteriores à cifra).
 * Só avisa: nunca impede o arranque nem altera dados.
 */
@Injectable()
export class SecretsBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(SecretsBootstrap.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      const plaintext = await countPlaintextSecrets(this.prisma);
      if (plaintext > 0) {
        this.logger.warn(
          `${plaintext} segredo(s) ainda guardado(s) em claro na base de dados. Corre "node dist/cli/encrypt-secrets.js" ` +
            '(ou "pnpm --filter backend secrets:encrypt") para os cifrar.',
        );
      }
    } catch (err) {
      this.logger.warn(`Não foi possível verificar os segredos guardados: ${(err as Error).message}`);
    }
  }
}
