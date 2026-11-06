import { execSync } from "node:child_process";
import * as path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabase, getTestDatabaseUrl } from "./test-env";

/** Cria a base de dados de testes (se não existir) e aplica as migrações. Corre uma vez antes de todos os testes. */
export default async function globalSetup() {
  const url = getTestDatabaseUrl();
  assertTestDatabase(url);

  const adminUrl = new URL(url);
  const dbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = "/postgres";

  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    // dbName já foi validado por assertTestDatabase (só letras, números e _).
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    if (!/already exists/i.test(String(err))) throw err;
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
