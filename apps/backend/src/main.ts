import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { findInsecureSecrets } from "./common/security";

async function bootstrap() {
  const insecure = findInsecureSecrets(process.env);
  if (insecure.length > 0) {
    throw new Error(`Configuração insegura para produção: ${insecure.join("; ")}`);
  }

  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
