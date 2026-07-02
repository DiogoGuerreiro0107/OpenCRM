#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function run(cmd, cwd = rootDir) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd });
}

function ensureEnvFile(dir) {
  const envPath = join(dir, ".env");
  const examplePath = join(dir, ".env.example");
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log(`Criado ${envPath} a partir de .env.example`);
  }
}

console.log("== OpenCRM: preparar ambiente de desenvolvimento ==");

ensureEnvFile(rootDir);
ensureEnvFile(join(rootDir, "apps", "backend"));
ensureEnvFile(join(rootDir, "apps", "frontend"));

try {
  run("docker compose up -d --wait postgres");
} catch {
  console.error(
    "\nNão foi possível arrancar o PostgreSQL via Docker. Verifica se o Docker Desktop está instalado e em execução.",
  );
  process.exit(1);
}

run("pnpm --filter backend exec prisma migrate deploy");

console.log("\n== Ambiente pronto. A arrancar backend + frontend... ==\n");
