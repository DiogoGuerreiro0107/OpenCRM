import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  await prisma.user.upsert({
    where: { email: "admin@globaltoner.local" },
    update: {},
    create: {
      email: "admin@globaltoner.local",
      name: "Administrador",
      passwordHash,
      role: "ADMIN",
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
            { name: "Ganho", type: "WON", order: 2 },
            { name: "Perdido", type: "LOST", order: 3 },
          ],
        },
      },
    });
  }

  if (process.env.EMAIL_ADDRESS && process.env.EMAIL_PASSWORD) {
    const emailAccountData = {
      username: process.env.EMAIL_ADDRESS,
      password: process.env.EMAIL_PASSWORD,
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
