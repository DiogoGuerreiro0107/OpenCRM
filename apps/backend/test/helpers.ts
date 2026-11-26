import { ensureSystemAutomationRules } from "../src/automations/registry/system-rules";
import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { PrismaService } from "../src/prisma/prisma.service";
import { ModulesService } from "../src/modules/modules.service";
import { PermissionsService } from "../src/auth/permissions.service";
import { ensureSystemWorkItemTypes } from "../src/work-item-types/system-types";

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app); // exatamente a mesma configuração (helmet, validação, CORS) que o main.ts
  await app.init();
  // Cada ficheiro de testes começa com todos os módulos ativos (valor por omissão), seja qual for o estado em que
  // o ficheiro anterior deixou a base de dados. (Só corre em bases de dados de teste: ver env.ts.)
  await app.get(PrismaService).moduleSetting.deleteMany();
  await app.get(ModulesService).reload();
  // ... e com as permissões predefinidas (Fase 0d).
  await app.get(PrismaService).permissionSetting.deleteMany();
  await app.get(PermissionsService).reload();
  return app;
}

/**
 * Apaga todos os dados (menos o histórico de migrações) e repõe os tipos de tarefa e as regras de automação do sistema,
 * como no arranque.
 * Só corre em bases de dados de teste (ver env.ts).
 */
/**
 * Esvazia todas as tabelas e recomeça a numeração. Com `DELETE`, não `TRUNCATE`: o `TRUNCATE` reconstrói todos os
 * índices e grava cada um em disco (`fsync`), o que com ~80 tabelas no Docker do Windows chegou a passar dos 30 s do
 * `beforeEach` (Fase 6d). Os `DELETE` correm com as chaves estrangeiras e os triggers desligados nesta transação
 * (`session_replication_role = replica`, que pede um superutilizador — o da base de testes local e do CI). Se não der,
 * volta ao `TRUNCATE`.
 */
export async function resetDatabase(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      for (const table of list) await tx.$executeRawUnsafe(`DELETE FROM ${table}`);
      await tx.$executeRawUnsafe(`
        SELECT setval(c.oid, 1, false) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'S' AND n.nspname = 'public'`);
    }, { timeout: 60_000 });
  } catch (err) {
    if (!/permission denied|must be superuser/i.test(String(err))) throw err;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list.join(", ")} RESTART IDENTITY CASCADE`);
  }
  await ensureSystemWorkItemTypes(prisma);
  await ensureSystemAutomationRules(prisma);
}

export const TEST_PASSWORD = "Teste-E2E-1";

export async function createUser(prisma: PrismaClient, role: Role, name = `Teste ${role}`) {
  return prisma.user.create({
    data: {
      email: `${role.toLowerCase()}@e2e.test`,
      name,
      role,
      passwordHash: await bcrypt.hash(TEST_PASSWORD, 4), // custo baixo: só para os testes serem rápidos
    },
  });
}

export async function bearerFor(app: INestApplication, user: { id: string; email: string; role: string }) {
  const jwt = app.get(JwtService);
  const token = await jwt.signAsync(
    { sub: user.id, email: user.email, role: user.role },
    { secret: process.env.JWT_SECRET, expiresIn: "10m" },
  );
  return `Bearer ${token}`;
}

export function prismaOf(app: INestApplication) {
  return app.get(PrismaService);
}
