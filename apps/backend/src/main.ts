import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { findInsecureSecrets, isAllowedOrigin, parseCorsOrigins } from "./common/security";

async function bootstrap() {
  const insecure = findInsecureSecrets(process.env);
  if (insecure.length > 0) {
    throw new Error(`Configuração insegura para produção: ${insecure.join("; ")}`);
  }

  const app = await NestFactory.create(AppModule);
  // "cross-origin": o frontend corre noutra porta e descarrega anexos/respostas desta API.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const extraOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  app.enableCors({
    credentials: true,
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin, extraOrigins)),
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
