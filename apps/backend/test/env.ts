import { assertTestDatabase, getTestDatabaseUrl } from "./test-env";

// Corre antes de cada ficheiro de testes, antes de qualquer módulo da app ser carregado.
const url = getTestDatabaseUrl();
assertTestDatabase(url);

process.env.DATABASE_URL = url;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "e2e-jwt-secret";
process.env.JWT_REFRESH_SECRET ??= "e2e-jwt-refresh-secret";
process.env.JWT_ACCESS_EXPIRES ??= "15m";
process.env.JWT_REFRESH_EXPIRES ??= "7d";
process.env.INTERNAL_API_KEY ??= "e2e-internal-key";
process.env.SECRETS_KEY ??= "e2e-secrets-key-com-mais-de-32-caracteres";
// Nunca disparar webhooks reais para o n8n a partir dos testes (o .env local pode ter o URL configurado).
process.env.N8N_WEBHOOK_URL = "";
