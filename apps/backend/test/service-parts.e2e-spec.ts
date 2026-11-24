import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";

// Fase 4c (docs/plano-fase-4-assistencias.md): peças usadas, hora de fecho dos itens de trabalho e indicadores.
describe("Assistências: peças, fecho e indicadores (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let rui: string;
  let ruiUser: { id: string };
  let ana: string;
  let anaUser: { id: string };

  const HOUR = 3600_000;
  const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    // A limpeza apaga as preferências dos módulos; a cache em memória tem de acompanhar (um teste desliga o módulo).
    await app.get(ModulesService).reload();
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    ruiUser = await createUser(prisma(), "TECNICO", "Rui Técnico");
    rui = await bearerFor(app, ruiUser as never);
    anaUser = await createUser(prisma(), "COMERCIAL", "Ana Comercial");
    ana = await bearerFor(app, anaUser as never);
  });

  afterAll(async () => {
    await app.close();
  });

  const newCase = async (body: Record<string, unknown> = {}, auth = rui) =>
    (await api().post("/service-cases").set("Authorization", auth).send({ reportedProblem: "Não liga", ...body }).expect(201)).body as { workItemId: string };
  const parts = (id: string) => `/service-cases/${id}/parts`;
  const notes = async (id: string) => (await prisma().timelineEvent.findMany({ where: { entityType: "TASK", entityId: id }, orderBy: { createdAt: "asc" } })).map((e) => e.description);
  const steps = async () =>
    (await api().get("/work-item-types").set("Authorization", admin).expect(200)).body.find((t: { id: string }) => t.id === "ASSISTENCIA").steps as Array<{ id: string; name: string }>;
  const stepId = async (name: string) => (await steps()).find((s) => s.name === name)!.id;
  /** Muda a tarefa para o passo (o passo lê-se antes: dois pedidos supertest sobrepostos fecham o servidor um ao outro). */
  const moveTo = async (id: string, name: string) => {
    const step = await stepId(name);
    await api().patch(`/tasks/${id}`).set("Authorization", rui).send({ stepId: step }).expect(200);
  };

  describe("peças", () => {
    it("adicionar, editar e retirar, com a timeline; a lista vem inteira e por ordem", async () => {
      const { workItemId: id } = await newCase();
      const a = (await api().post(parts(id)).set("Authorization", rui).send({ description: " Rolo de alimentação ", reference: "RM2-5452", quantity: 2 }).expect(201)).body;
      expect(a).toMatchObject({ description: "Rolo de alimentação", reference: "RM2-5452", quantity: 2, createdBy: { id: ruiUser.id } });
      const b = (await api().post(parts(id)).set("Authorization", ana).send({ description: "Cabo de rede", quantity: 1.5 }).expect(201)).body;
      expect(b).toMatchObject({ reference: null, quantity: 1.5 });
      expect((await api().post(parts(id)).set("Authorization", rui).send({ description: "Parafuso" }).expect(201)).body.quantity).toBe(1);

      // Quem tem escrita corrige (não há dono).
      await api().patch(`${parts(id)}/${a.id}`).set("Authorization", ana).send({ quantity: 3, reference: null }).expect(200);
      // Sem mudanças, nada na timeline.
      await api().patch(`${parts(id)}/${b.id}`).set("Authorization", rui).send({ description: "Cabo de rede" }).expect(200);
      await api().delete(`${parts(id)}/${b.id}`).set("Authorization", rui).expect(204);
      await api().delete(`${parts(id)}/${b.id}`).set("Authorization", rui).expect(404);

      const list = (await api().get(parts(id)).set("Authorization", rui).expect(200)).body;
      expect(list.map((p: { description: string; quantity: number }) => [p.description, p.quantity])).toEqual([["Rolo de alimentação", 3], ["Parafuso", 1]]);
      expect(await notes(id)).toEqual([
        "Peça usada: 2 × Rolo de alimentação (RM2-5452)",
        "Peça usada: 1,5 × Cabo de rede",
        "Peça usada: 1 × Parafuso",
        "Peça alterada: 2 × Rolo de alimentação (RM2-5452) → 3 × Rolo de alimentação",
        "Peça retirada: 1,5 × Cabo de rede",
      ]);
    });

    it("validações, limite por assistência, peça de outra assistência e assistência inexistente", async () => {
      const { workItemId: id } = await newCase();
      const other = await newCase();
      await api().post(parts(id)).set("Authorization", rui).send({ description: "  " }).expect(400);
      await api().post(parts(id)).set("Authorization", rui).send({ description: "X", quantity: 0 }).expect(400);
      await api().post(parts(id)).set("Authorization", rui).send({ description: "X", quantity: -1 }).expect(400);
      await api().post(parts(id)).set("Authorization", rui).send({ description: "X", quantity: 1.234 }).expect(400);
      await api().post(parts("nao-existe")).set("Authorization", rui).send({ description: "X" }).expect(404);
      await api().get(parts("nao-existe")).set("Authorization", rui).expect(404);
      // Também a base de dados recusa quantidades não positivas.
      await expect(prisma().servicePart.create({ data: { serviceCaseId: id, description: "X", quantity: 0 } })).rejects.toThrow();

      const p = (await api().post(parts(other.workItemId)).set("Authorization", rui).send({ description: "X" }).expect(201)).body;
      await api().patch(`${parts(id)}/${p.id}`).set("Authorization", rui).send({ quantity: 2 }).expect(404);
      await api().delete(`${parts(id)}/${p.id}`).set("Authorization", rui).expect(404);

      await prisma().servicePart.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ serviceCaseId: id, description: `P${i}` })) });
      await api().post(parts(id)).set("Authorization", rui).send({ description: "Uma a mais" }).expect(400);

      // Apagar a assistência (a tarefa) apaga as peças.
      await api().delete(`/tasks/${other.workItemId}`).set("Authorization", rui).expect(204);
      expect(await prisma().servicePart.count({ where: { serviceCaseId: other.workItemId } })).toBe(0);
    });

    it("permissões e módulo desligado", async () => {
      const { workItemId: id } = await newCase();
      const reader = await bearerFor(app, await createUser(prisma(), "LEITURA_APENAS"));
      await api().get(parts(id)).set("Authorization", reader).expect(200);
      await api().post(parts(id)).set("Authorization", reader).send({ description: "X" }).expect(403);
      await api().get("/service-cases/indicators").set("Authorization", reader).expect(200);

      await api().patch("/modules/assistencias").set("Authorization", admin).send({ enabled: false }).expect(200);
      await api().get(parts(id)).set("Authorization", rui).expect(404);
      await api().get("/service-cases/indicators").set("Authorization", rui).expect(404);
    });
  });

  describe("hora de fecho (closedAt), mantida pela base de dados", () => {
    it("concluir grava; mudar entre fechados mantém; reabrir limpa; criar já fechada grava", async () => {
      const t = (await api().post("/tasks").set("Authorization", rui).send({ title: "T" }).expect(201)).body;
      const closedAt = async () => (await prisma().workItem.findUniqueOrThrow({ where: { id: t.id } })).closedAt;
      expect(await closedAt()).toBeNull();

      const before = Date.now();
      await api().patch(`/tasks/${t.id}`).set("Authorization", rui).send({ status: "DONE" }).expect(200);
      const first = await closedAt();
      expect(first).not.toBeNull();
      expect(Math.abs(first!.getTime() - before)).toBeLessThan(60_000);

      await api().patch(`/tasks/${t.id}`).set("Authorization", rui).send({ status: "CANCELLED" }).expect(200);
      expect((await closedAt())!.getTime()).toBe(first!.getTime());
      await api().patch(`/tasks/${t.id}`).set("Authorization", rui).send({ title: "T2" }).expect(200);
      expect((await closedAt())!.getTime()).toBe(first!.getTime());

      await api().patch(`/tasks/${t.id}`).set("Authorization", rui).send({ status: "IN_PROGRESS" }).expect(200);
      expect(await closedAt()).toBeNull();

      const done = (await api().post("/tasks").set("Authorization", rui).send({ title: "Já feita", status: "DONE" }).expect(201)).body;
      expect((await prisma().workItem.findUniqueOrThrow({ where: { id: done.id } })).closedAt).not.toBeNull();
    });

    it("por passos e por escrita direta na base de dados (passos movidos em bloco)", async () => {
      const { workItemId: id } = await newCase();
      await moveTo(id, "Resolvida");
      expect((await prisma().workItem.findUniqueOrThrow({ where: { id } })).closedAt).not.toBeNull();
      await moveTo(id, "Diagnóstico");
      expect((await prisma().workItem.findUniqueOrThrow({ where: { id } })).closedAt).toBeNull();

      const t = (await api().post("/tasks").set("Authorization", rui).send({ title: "T" }).expect(201)).body;
      await prisma().workItem.updateMany({ where: { id: t.id }, data: { status: "CANCELLED" } });
      expect((await prisma().workItem.findUniqueOrThrow({ where: { id: t.id } })).closedAt).not.toBeNull();
    });
  });

  describe("indicadores", () => {
    it("em aberto por passo, entradas, resolvidas, sem reparação, tempo até resolver, tempo por técnico e peças", async () => {
      const a = await newCase({ assigneeId: ruiUser.id });
      const b = await newCase({ assigneeId: ruiUser.id });
      const c = await newCase({ assigneeId: anaUser.id });
      const d = await newCase({ assigneeId: ruiUser.id });
      const e = await newCase({ assigneeId: ruiUser.id });
      await moveTo(e.workItemId, "Diagnóstico");

      // Entradas há 2 h, 4 h e 9 h; resolvidas agora → média 5 h, mediana 4 h.
      for (const [item, h] of [[a, 2], [b, 4], [c, 9]] as const) {
        await prisma().serviceCase.update({ where: { workItemId: item.workItemId }, data: { createdAt: hoursAgo(h) } });
        await moveTo(item.workItemId, "Resolvida");
      }
      await moveTo(d.workItemId, "Sem reparação");
      // Uma antiga, fechada há 40 dias: fica fora do período.
      const old = await newCase();
      await prisma().serviceCase.update({ where: { workItemId: old.workItemId }, data: { createdAt: hoursAgo(24 * 45) } });
      await moveTo(old.workItemId, "Resolvida");
      await prisma().workItem.update({ where: { id: old.workItemId }, data: { closedAt: hoursAgo(24 * 40) } });

      // Tempo: em assistências conta (por técnico); numa tarefa comum não; fora do período não.
      const plain = (await api().post("/tasks").set("Authorization", rui).send({ title: "Comum" }).expect(201)).body;
      await prisma().timeEntry.createMany({
        data: [
          { workItemId: a.workItemId, userId: ruiUser.id, startedAt: hoursAgo(3), endedAt: hoursAgo(2) },
          { workItemId: b.workItemId, userId: ruiUser.id, startedAt: hoursAgo(2), endedAt: hoursAgo(1.5), billable: false },
          { workItemId: c.workItemId, userId: anaUser.id, startedAt: hoursAgo(5), endedAt: hoursAgo(3) },
          { workItemId: plain.id, userId: ruiUser.id, startedAt: hoursAgo(6), endedAt: hoursAgo(5) },
          { workItemId: a.workItemId, userId: ruiUser.id, startedAt: hoursAgo(24 * 40), endedAt: hoursAgo(24 * 40 - 1) },
        ],
      });
      // Peças: a mesma peça escrita de formas diferentes junta-se.
      await api().post(parts(a.workItemId)).set("Authorization", rui).send({ description: "Rolo de alimentação", reference: "RM2", quantity: 2 }).expect(201);
      await api().post(parts(b.workItemId)).set("Authorization", rui).send({ description: "rolo de alimentação ", reference: "RM2", quantity: 1 }).expect(201);
      await api().post(parts(c.workItemId)).set("Authorization", rui).send({ description: "Fusor", quantity: 1 }).expect(201);

      const from = hoursAgo(24 * 30).toISOString();
      const to = new Date(Date.now() + HOUR).toISOString();
      const all = (await api().get("/service-cases/indicators").query({ from, to }).set("Authorization", rui).expect(200)).body;
      expect(all).toMatchObject({ openTotal: 1, openByStep: [{ name: "Diagnóstico", count: 1 }], created: 5, resolved: 3, notRepaired: 1 });
      expect(all.resolution).toEqual({ averageHours: 5, medianHours: 4 });
      expect(all.timeByTechnician).toEqual([
        { user: { id: anaUser.id, name: "Ana Comercial" }, totalSeconds: 7200, billableSeconds: 7200 },
        { user: { id: ruiUser.id, name: "Rui Técnico" }, totalSeconds: 5400, billableSeconds: 3600 },
      ]);
      expect(all.topParts).toEqual([
        { productId: null, description: "Rolo de alimentação", reference: "RM2", quantity: 3, cases: 2 },
        { productId: null, description: "Fusor", reference: null, quantity: 1, cases: 1 },
      ]);

      // Por pessoa: responsável das assistências; técnico no tempo.
      const ruiOnly = (await api().get("/service-cases/indicators").query({ from, to, assigneeId: ruiUser.id }).set("Authorization", rui).expect(200)).body;
      expect(ruiOnly).toMatchObject({ openTotal: 1, created: 4, resolved: 2, notRepaired: 1 });
      expect(ruiOnly.resolution).toEqual({ averageHours: 3, medianHours: 3 });
      expect(ruiOnly.timeByTechnician.map((t: { user: { id: string } }) => t.user.id)).toEqual([ruiUser.id]);
      expect(ruiOnly.topParts.map((p: { description: string }) => p.description)).toEqual(["Rolo de alimentação"]);

      // Período sem nada; períodos inválidos.
      const empty = (await api().get("/service-cases/indicators").query({ from: hoursAgo(24 * 100).toISOString(), to: hoursAgo(24 * 90).toISOString() }).set("Authorization", rui).expect(200)).body;
      expect(empty).toMatchObject({ created: 0, resolved: 0, notRepaired: 0, resolution: { averageHours: null, medianHours: null }, timeByTechnician: [], topParts: [] });
      expect(empty.openTotal).toBe(1);
      await api().get("/service-cases/indicators").query({ from: to, to: from }).set("Authorization", rui).expect(400);
      await api().get("/service-cases/indicators").query({ from: "2000-01-01T00:00:00Z", to: "2030-01-01T00:00:00Z" }).set("Authorization", rui).expect(400);
      // Sem período: o mês corrente.
      const month = (await api().get("/service-cases/indicators").set("Authorization", rui).expect(200)).body;
      expect(new Date(month.period.from).getUTCDate()).toBe(1);
    });
  });
});
