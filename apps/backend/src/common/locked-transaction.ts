import { ConflictException } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Transação para trabalho com uma linha bloqueada (`SELECT … FOR UPDATE`): os pedidos simultâneos sobre o mesmo
 * registo esperam em fila. A espera do Prisma (2 s por omissão) é alargada; se mesmo assim se esgotar, responde 409
 * («tenta de novo») em vez de 500. Usada pelo stock (5b) e pelas encomendas (6a).
 */
export async function lockedTransaction<T>(prisma: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>, busyMessage = "Há muitas alterações a ser feitas ao mesmo tempo: tenta de novo"): Promise<T> {
  try {
    return await prisma.$transaction(fn, { maxWait: 15_000, timeout: 15_000 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") throw new ConflictException(busyMessage);
    throw err;
  }
}
