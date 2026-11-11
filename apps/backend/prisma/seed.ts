import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { deriveKey, encryptSecret, secretsKeyProblem } from "../src/common/secrets";

const prisma = new PrismaClient();

async function main() {
  // Em produção define SEED_ADMIN_PASSWORD; o valor por omissão só serve para desenvolvimento local.
  const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? "admin123", 10);

  await prisma.user.upsert({
    where: { email: "admin@globaltoner.local" },
    update: {},
    create: {
      email: "admin@globaltoner.local",
      name: "Administrador",
      passwordHash,
      role: "ADMINISTRADOR",
    },
  });

  const pipelineExists = await prisma.pipeline.findFirst();
  if (!pipelineExists) {
    await prisma.pipeline.create({
      data: {
        name: "Vendas",
        stages: {
          create: [
            { name: "Novo", type: "OPEN", order: 0 },
            { name: "Em negociação", type: "OPEN", order: 1 },
            { name: "Proposta enviada", type: "OPEN", order: 2 },
            { name: "Ganho", type: "WON", order: 3 },
            { name: "Perdido", type: "LOST", order: 4 },
          ],
        },
      },
    });
  }

  if (process.env.EMAIL_ADDRESS && process.env.EMAIL_PASSWORD) {
    // A password da caixa de email fica cifrada na base de dados (docs/plano-e0-api-publica.md).
    const keyProblem = secretsKeyProblem(process.env.SECRETS_KEY);
    if (keyProblem) throw new Error(`${keyProblem}: precisa dela para guardar a password do email`);
    const emailAccountData = {
      username: process.env.EMAIL_ADDRESS,
      password: encryptSecret(process.env.EMAIL_PASSWORD, deriveKey(process.env.SECRETS_KEY!), "EmailAccount.password"),
      imapHost: process.env.IMAP_HOST!,
      imapPort: Number(process.env.IMAP_PORT ?? 993),
      imapSecure: process.env.IMAP_SECURE !== "false",
      smtpHost: process.env.SMTP_HOST!,
      smtpPort: Number(process.env.SMTP_PORT ?? 465),
      smtpSecure: process.env.SMTP_SECURE !== "false",
    };

    await prisma.emailAccount.upsert({
      where: { email: process.env.EMAIL_ADDRESS },
      update: emailAccountData,
      create: { email: process.env.EMAIL_ADDRESS, ...emailAccountData },
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
