import { INestApplication, ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { isAllowedOrigin, parseCorsOrigins } from "./common/security";

/**
 * Configuração HTTP partilhada entre o arranque real (main.ts) e os testes e2e,
 * para que os testes exercitem exatamente o que corre em produção.
 */
export function configureApp(app: INestApplication) {
  // "cross-origin": o frontend corre noutra porta e descarrega anexos/respostas desta API.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const extraOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
  app.enableCors({
    credentials: true,
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin, extraOrigins)),
  });
}
