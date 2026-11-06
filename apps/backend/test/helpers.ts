import { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { PrismaClient, Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { PrismaService } from "../src/prisma/prisma.service";

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app); // exatamente a mesma configuração (helmet, validação, CORS) que o main.ts
  await app.init();
  return app;
}

/** Apaga todos os dados (menos o histórico de migrações). Só corre em bases de dados de teste (ver env.ts). */
export async function resetDatabase(prisma: PrismaClient) {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
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
