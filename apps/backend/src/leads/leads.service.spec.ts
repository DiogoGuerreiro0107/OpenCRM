import { LeadsService } from "./leads.service";

/**
 * Atomicidade da conversão de lead. O rollback em si é garantido pelo Postgres/Prisma; o que estes testes
 * fixam é que TODAS as escritas da conversão passam pela transação (`tx`) e nenhuma pelo cliente normal —
 * se alguém voltar a escrever com `this.prisma.*` dentro de convert(), o teste falha.
 */
describe("LeadsService.convert é atómica", () => {
  const lead = {
    id: "lead-1",
    name: "Ana",
    companyName: "Empresa Lda",
    email: "ana@x.pt",
    phone: "912345678",
    source: "site",
    responsavelId: null,
    convertedDealId: null,
  };
  const pipeline = { id: "p1", stages: [{ id: "s1", type: "OPEN", order: 0 }] };

  function buildMocks(dealCreate: jest.Mock) {
    const tx = {
      company: { create: jest.fn().mockResolvedValue({ id: "c1", name: "Empresa Lda" }) },
      contact: { create: jest.fn().mockResolvedValue({ id: "ct1", name: "Ana" }) },
      deal: { create: dealCreate },
      timelineEvent: { createMany: jest.fn().mockResolvedValue({ count: 3 }) },
      lead: { update: jest.fn().mockResolvedValue({ ...lead, status: "CONVERTIDO" }) },
    };
    const prisma = {
      lead: { findUnique: jest.fn().mockResolvedValue(lead), update: jest.fn() },
      pipeline: { findFirst: jest.fn().mockResolvedValue(pipeline) },
      // fora da transação não pode ser escrito nada:
      company: { create: jest.fn() },
      contact: { create: jest.fn() },
      deal: { create: jest.fn() },
      timelineEvent: { createMany: jest.fn() },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = new LeadsService(prisma as never, { trigger: jest.fn() } as never);
    return { service, prisma, tx };
  }

  it("faz todas as escritas dentro da transação", async () => {
    const { service, prisma, tx } = buildMocks(jest.fn().mockResolvedValue({ id: "d1" }));

    await service.convert("lead-1", "user-1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.company.create).toHaveBeenCalled();
    expect(tx.contact.create).toHaveBeenCalled();
    expect(tx.deal.create).toHaveBeenCalled();
    expect(tx.timelineEvent.createMany).toHaveBeenCalled();
    expect(tx.lead.update).toHaveBeenCalled();

    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.contact.create).not.toHaveBeenCalled();
    expect(prisma.deal.create).not.toHaveBeenCalled();
    expect(prisma.timelineEvent.createMany).not.toHaveBeenCalled();
    expect(prisma.lead.update).not.toHaveBeenCalled();
  });

  it("se um passo falha, o erro propaga-se e o lead não chega a ser marcado como convertido", async () => {
    const failure = new Error("falha simulada ao criar o negócio");
    const { service, tx } = buildMocks(jest.fn().mockRejectedValue(failure));

    await expect(service.convert("lead-1", "user-1")).rejects.toThrow(failure);

    expect(tx.lead.update).not.toHaveBeenCalled();
    expect(tx.timelineEvent.createMany).not.toHaveBeenCalled();
  });
});
