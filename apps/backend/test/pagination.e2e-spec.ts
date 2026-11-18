import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

/**
 * Paginação e pesquisa nas listagens (docs/plano-paginacao-listagens.md): percorrer as páginas devolve cada linha
 * exatamente uma vez e pela ordem da lista, mesmo com empates na chave; nenhuma rota devolve a tabela toda.
 */
describe("Paginação das listagens (e2e)", () => {
  let app: INestApplication;
  let auth: string;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    const prisma = prismaOf(app);
    await resetDatabase(prisma);
    auth = await bearerFor(app, await createUser(prisma, "COMERCIAL"));
    admin = await bearerFor(app, await createUser(prisma, "ADMINISTRADOR"));
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const get = (path: string, query: Record<string, unknown> = {}) => api().get(path).query(query).set("Authorization", auth);

  /** Percorre todas as páginas; devolve os ids pela ordem recebida e quantas páginas foram. */
  async function walk(path: string, query: Record<string, unknown>) {
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const body: { items: Array<{ id: string }>; nextCursor: string | null } = (await get(path, { ...query, ...(cursor ? { cursor } : {}) }).expect(200)).body;
      ids.push(...body.items.map((i) => i.id));
      cursor = body.nextCursor;
      pages++;
      if (pages > 100) throw new Error("não termina");
    } while (cursor);
    return { ids, pages };
  }

  it("empresas: páginas por (nome, id), com nomes repetidos, sem repetir nem saltar", async () => {
    const prisma = prismaOf(app);
    for (let i = 0; i < 6; i++) await prisma.company.create({ data: { name: "Igual" } });
    for (let i = 0; i < 11; i++) await prisma.company.create({ data: { name: `Firma ${String.fromCharCode(75 - i)}` } });
    const expected = (await prisma.company.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true } })).map((c) => c.id);

    const { ids, pages } = await walk("/companies", { limit: 4 });
    expect(ids).toEqual(expected);
    expect(pages).toBe(5); // 17 linhas em páginas de 4
  });

  it("contactos: páginas com filtro por empresa e pesquisa", async () => {
    const prisma = prismaOf(app);
    const acme = await prisma.company.create({ data: { name: "Acme" } });
    for (let i = 0; i < 7; i++) await prisma.contact.create({ data: { name: i % 2 ? "Ana" : "Rui", companyId: acme.id } });
    await prisma.contact.create({ data: { name: "Fora" } });
    const expected = (await prisma.contact.findMany({ where: { companyId: acme.id }, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true } })).map((c) => c.id);

    expect((await walk("/contacts", { companyId: acme.id, limit: 2 })).ids).toEqual(expected);
    expect((await walk("/contacts", { companyId: acme.id, search: "ANA", limit: 2 })).ids).toHaveLength(3);

    // a contagem de contactos (lista e ficha) é só da empresa e certa
    const companies = (await get("/companies").expect(200)).body.items as Array<{ name: string; _count: { contacts: number } }>;
    expect(companies.find((c) => c.name === "Acme")?._count.contacts).toBe(7);
    expect((await get(`/companies/${acme.id}`).expect(200)).body._count).toEqual({ contacts: 7 });
  });

  it("tarefas: prazo (sem prazo no fim), depois criação mais recente, depois id — com empates", async () => {
    const prisma = prismaOf(app);
    const user = await prisma.user.findFirstOrThrow();
    const sameDue = new Date("2026-12-01T10:00:00Z");
    const sameCreated = new Date("2026-11-01T09:00:00Z");
    const data = [
      ...Array.from({ length: 4 }, (_, i) => ({ title: `Igual ${i}`, dueDate: sameDue, createdAt: sameCreated })),
      ...Array.from({ length: 3 }, (_, i) => ({ title: `Sem prazo ${i}`, dueDate: null, createdAt: sameCreated })),
      { title: "Cedo", dueDate: new Date("2026-11-20T08:00:00Z") },
      { title: "Tarde", dueDate: new Date("2027-01-05T08:00:00Z") },
      { title: "Sem prazo recente", dueDate: null, createdAt: new Date("2026-11-10T09:00:00Z") },
    ];
    for (const d of data) await prisma.task.create({ data: { ...d, assigneeId: user.id } });
    const expected = (
      await prisma.task.findMany({ orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }], select: { id: true } })
    ).map((t) => t.id);

    const { ids } = await walk("/tasks", { limit: 3 });
    expect(ids).toEqual(expected);

    const titles = (await get("/tasks", { search: "sem prazo" }).expect(200)).body.items.map((t: { title: string }) => t.title);
    // sem prazo, a criação mais recente primeiro; os três restantes empatam e seguem pelo id
    expect(titles[0]).toBe("Sem prazo recente");
    expect([...titles].sort()).toEqual(["Sem prazo 0", "Sem prazo 1", "Sem prazo 2", "Sem prazo recente"]);
  });

  it("tarefas: pesquisa sem acentos no título e na descrição; colunas internas não saem", async () => {
    const prisma = prismaOf(app);
    const user = await prisma.user.findFirstOrThrow();
    await prisma.task.create({ data: { title: "Ligar ao João", assigneeId: user.id } });
    await prisma.task.create({ data: { title: "Visita", description: "Levar orçamento", assigneeId: user.id } });
    await prisma.task.create({ data: { title: "Outra", assigneeId: user.id } });
    const find = async (search: string) => (await get("/tasks", { search }).expect(200)).body.items.map((t: { title: string }) => t.title);
    expect(await find("joao")).toEqual(["Ligar ao João"]);
    expect(await find("ORCAMENTO")).toEqual(["Visita"]);
    const text = (await get("/tasks").expect(200)).text;
    expect(text).not.toContain("searchText");
    expect(text).not.toContain("dueSort");
  });

  it("calendário de tarefas: intervalo obrigatório e limitado; devolve só o intervalo", async () => {
    const prisma = prismaOf(app);
    const user = await prisma.user.findFirstOrThrow();
    await prisma.task.create({ data: { title: "Dentro", dueDate: new Date("2026-11-15T10:00:00Z"), assigneeId: user.id } });
    await prisma.task.create({ data: { title: "Fora", dueDate: new Date("2027-03-15T10:00:00Z"), assigneeId: user.id } });
    await prisma.task.create({ data: { title: "Sem prazo", assigneeId: user.id } });

    const range = { from: "2026-10-26T00:00:00Z", to: "2026-12-07T00:00:00Z" };
    const month = (await get("/tasks/calendar", range).expect(200)).body;
    expect(month.items.map((t: { title: string }) => t.title)).toEqual(["Dentro"]);
    expect(month.countsByDay).toEqual({ "2026-11-15": 1 });
    await get("/tasks/calendar").expect(400);
    await get("/tasks/calendar", { from: "2026-01-01T00:00:00Z", to: "2026-12-31T00:00:00Z" }).expect(400);
    await get("/tasks/calendar", { from: "2026-12-01T00:00:00Z", to: "2026-11-01T00:00:00Z" }).expect(400);
    await get("/tasks/calendar", { ...range, tz: "Lua/Mar_da_Tranquilidade" }).expect(400);
    await get("/tasks/calendar", { ...range, tz: "Europe/Lisbon'; --" }).expect(400);
  });

  it("calendário: no máximo 3 tarefas por dia (as primeiras do dia) e a contagem de cada dia, no fuso do browser", async () => {
    const prisma = prismaOf(app);
    const [ana, rui] = [await prisma.user.findFirstOrThrow(), await createUser(prisma, "TECNICO", "Rui")];
    for (let h = 8; h < 14; h++) {
      await prisma.task.create({ data: { title: `Dia 10 às ${h}h`, dueDate: new Date(`2026-11-10T${String(h).padStart(2, "0")}:00:00Z`), assigneeId: h % 2 ? rui.id : ana.id } });
    }
    // 23h30 UTC de 11/11 já é dia 12 em Lisboa? Não (Lisboa = UTC em novembro); em Madrid (UTC+1) sim.
    await prisma.task.create({ data: { title: "Fronteira", dueDate: new Date("2026-11-11T23:30:00Z"), assigneeId: ana.id } });
    const range = { from: "2026-11-01T00:00:00Z", to: "2026-11-30T23:59:59Z" };

    const all = (await get("/tasks/calendar", { ...range, tz: "Europe/Lisbon" }).expect(200)).body;
    expect(all.items.filter((t: { title: string }) => t.title.startsWith("Dia 10")).map((t: { title: string }) => t.title)).toEqual([
      "Dia 10 às 8h",
      "Dia 10 às 9h",
      "Dia 10 às 10h",
    ]);
    expect(all.countsByDay).toEqual({ "2026-11-10": 6, "2026-11-11": 1 });
    expect((await get("/tasks/calendar", { ...range, tz: "Europe/Madrid" }).expect(200)).body.countsByDay).toEqual({ "2026-11-10": 6, "2026-11-12": 1 });

    const ruis = (await get("/tasks/calendar", { ...range, tz: "Europe/Lisbon", assigneeId: rui.id }).expect(200)).body;
    expect(ruis.countsByDay).toEqual({ "2026-11-10": 3 });
  });

  describe("quadro de negócios", () => {
    let pipeline: { id: string; stages: Array<{ id: string; name: string; type: string }> };
    const createDeal = (body: Record<string, unknown>) => api().post("/deals").set("Authorization", auth).send(body).expect(201).then((r) => r.body);

    beforeEach(async () => {
      pipeline = (await api().post("/pipelines").set("Authorization", admin).send({ name: "Vendas" }).expect(201)).body;
    });

    it("pipelineId é obrigatório (nunca devolve os negócios todos)", async () => {
      await get("/deals").expect(400);
      await get("/deals/summary").expect(400);
    });

    it("cada coluna é paginada; os negócios novos entram no topo; o resumo conta a coluna inteira", async () => {
      const [first, second] = pipeline.stages;
      const created: string[] = [];
      for (let i = 0; i < 7; i++) created.push((await createDeal({ title: `N${i}`, pipelineId: pipeline.id, stageId: first.id, value: 10 })).id);
      await createDeal({ title: "Outra coluna", pipelineId: pipeline.id, stageId: second.id, value: 5 });

      const { ids, pages } = await walk("/deals", { pipelineId: pipeline.id, stageId: first.id, limit: 3 });
      expect(ids).toEqual([...created].reverse()); // o mais recente no topo
      expect(pages).toBe(3);

      const summary = (await get("/deals/summary", { pipelineId: pipeline.id }).expect(200)).body;
      expect(summary).toEqual(
        expect.arrayContaining([
          { stageId: first.id, count: 7, totalValue: 70 },
          { stageId: second.id, count: 1, totalValue: 5 },
        ]),
      );
    });

    it("mover para uma coluna só em parte carregada põe o negócio na posição largada; os outros não mudam o updatedAt", async () => {
      const [first, second] = pipeline.stages;
      for (let i = 0; i < 6; i++) await createDeal({ title: `A${i}`, pipelineId: pipeline.id, stageId: first.id });
      const moving = await createDeal({ title: "Vem", pipelineId: pipeline.id, stageId: second.id });
      const prisma = prismaOf(app);
      const before = await prisma.deal.findMany({ where: { stageId: first.id }, select: { id: true, updatedAt: true } });

      // O ecrã tem só os 3 primeiros cartões da coluna e larga o negócio no fim deles (posição 3).
      const loaded = (await get("/deals", { pipelineId: pipeline.id, stageId: first.id, limit: 3 }).expect(200)).body.items.map((d: { id: string }) => d.id);
      await api().patch(`/deals/${moving.id}/move`).set("Authorization", auth).send({ stageId: first.id, index: 3 }).expect(200);

      const column = (await walk("/deals", { pipelineId: pipeline.id, stageId: first.id, limit: 50 })).ids;
      expect(column).toHaveLength(7);
      expect(column.slice(0, 4)).toEqual([...loaded, moving.id]);

      const after = await prisma.deal.findMany({ where: { id: { in: before.map((b) => b.id) } }, select: { id: true, updatedAt: true } });
      for (const b of before) expect(after.find((a) => a.id === b.id)?.updatedAt).toEqual(b.updatedAt);
    });

    it("pesquisa por título, empresa ou contacto, sem acentos; o resumo segue a pesquisa", async () => {
      const [first] = pipeline.stages;
      const prisma = prismaOf(app);
      const company = await prisma.company.create({ data: { name: "Gráfica Sé" } });
      const contact = await prisma.contact.create({ data: { name: "Inês Lopes" } });
      await createDeal({ title: "Impressoras", pipelineId: pipeline.id, stageId: first.id, companyId: company.id, value: 3 });
      await createDeal({ title: "Software", pipelineId: pipeline.id, stageId: first.id, contactId: contact.id, value: 4 });
      await createDeal({ title: "Papelaria São Bento", pipelineId: pipeline.id, stageId: first.id, value: 5 });

      const titles = async (search: string) =>
        (await get("/deals", { pipelineId: pipeline.id, search }).expect(200)).body.items.map((d: { title: string }) => d.title);
      expect(await titles("grafica se")).toEqual(["Impressoras"]);
      expect(await titles("ines")).toEqual(["Software"]);
      expect(await titles("sao bento")).toEqual(["Papelaria São Bento"]);
      expect((await get("/deals/summary", { pipelineId: pipeline.id, search: "ines" }).expect(200)).body).toEqual([{ stageId: first.id, count: 1, totalValue: 4 }]);
      expect((await get("/deals", { pipelineId: pipeline.id }).expect(200)).text).not.toContain("searchText");
    });

    it("pesquisa acompanha a empresa e o contacto: mudar o nome, desligar ou apagar atualiza os negócios", async () => {
      const [first] = pipeline.stages;
      const company = (await api().post("/companies").set("Authorization", auth).send({ name: "Antiga Lda" }).expect(201)).body;
      const contact = (await api().post("/contacts").set("Authorization", auth).send({ name: "Zé Contacto" }).expect(201)).body;
      const deal = await createDeal({ title: "Toner", pipelineId: pipeline.id, stageId: first.id, companyId: company.id, contactId: contact.id });
      const found = async (search: string) => (await get("/deals", { pipelineId: pipeline.id, search }).expect(200)).body.items.map((d: { id: string }) => d.id);
      expect(await found("antiga")).toEqual([deal.id]);
      expect(await found("ze contacto")).toEqual([deal.id]);

      await api().patch(`/companies/${company.id}`).set("Authorization", auth).send({ name: "Nova Gráfica" }).expect(200);
      expect(await found("antiga")).toEqual([]);
      expect(await found("nova grafica")).toEqual([deal.id]);

      await api().patch(`/deals/${deal.id}`).set("Authorization", auth).send({ companyId: null }).expect(200);
      expect(await found("nova grafica")).toEqual([]);

      await api().delete(`/contacts/${contact.id}`).set("Authorization", admin).expect((r) => expect([200, 204]).toContain(r.status));
      expect(await found("ze contacto")).toEqual([]);
      expect(await found("toner")).toEqual([deal.id]);
    });

    it("dashboard: contagens por funil vêm da base de dados e batem certo", async () => {
      const open = pipeline.stages.find((s) => s.type === "OPEN")!;
      const won = pipeline.stages.find((s) => s.type === "WON")!;
      await createDeal({ title: "a", pipelineId: pipeline.id, stageId: open.id });
      await createDeal({ title: "b", pipelineId: pipeline.id, stageId: open.id });
      await createDeal({ title: "c", pipelineId: pipeline.id, stageId: won.id });
      const summary = (await get("/dashboard/summary").expect(200)).body;
      expect(summary.pipelines).toEqual([{ id: pipeline.id, name: "Vendas", open: 2, won: 1, lost: 0, conversionRate: 100 }]);
    });
  });

  it("emails: mais recentes primeiro, com empates de data; pesquisa sem acentos na caixa", async () => {
    const prisma = prismaOf(app);
    const account = await prisma.emailAccount.create({
      data: { email: "caixa@teste.local", imapHost: "imap.teste.local", imapPort: 993, smtpHost: "smtp.teste.local", smtpPort: 465, username: "caixa", password: "x" },
    });
    const sameSent = new Date("2026-11-10T10:00:00Z");
    for (let i = 0; i < 5; i++) {
      await prisma.emailMessage.create({
        data: { accountId: account.id, direction: "INBOUND", messageId: `<m${i}@t>`, fromAddress: `c${i}@cliente.pt`, toAddresses: ["caixa@teste.local"], subject: i === 2 ? "Orçamento de papelaria" : `Assunto ${i}`, sentAt: i < 3 ? sameSent : new Date(`2026-11-0${i}T10:00:00Z`) },
      });
    }
    const expected = (await prisma.emailMessage.findMany({ orderBy: [{ sentAt: "desc" }, { id: "desc" }], select: { id: true } })).map((m) => m.id);
    expect((await walk("/email/messages", { limit: 2 })).ids).toEqual(expected);

    const found = (await get("/email/messages", { search: "orcamento" }).expect(200)).body;
    expect(found.items.map((m: { subject: string }) => m.subject)).toEqual(["Orçamento de papelaria"]);
    expect((await get("/email/messages", { search: "C4@CLIENTE" }).expect(200)).body.items).toHaveLength(1);
    expect(JSON.stringify(found)).not.toContain("searchText");
  });

  it("timeline: histórico de um registo por páginas, mais recente primeiro, com empates", async () => {
    const prisma = prismaOf(app);
    const user = await prisma.user.findFirstOrThrow();
    const company = await prisma.company.create({ data: { name: "Com histórico" } });
    const same = new Date("2026-11-10T10:00:00Z");
    for (let i = 0; i < 7; i++) {
      await prisma.timelineEvent.create({ data: { entityType: "COMPANY", entityId: company.id, userId: user.id, description: `e${i}`, createdAt: i < 4 ? same : undefined } });
    }
    const expected = (
      await prisma.timelineEvent.findMany({ where: { entityType: "COMPANY", entityId: company.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } })
    ).map((e) => e.id);
    expect((await walk("/timeline", { entityType: "COMPANY", entityId: company.id, limit: 3 })).ids).toEqual(expected);
  });

  it("chamadas: por páginas, mais recentes primeiro", async () => {
    const prisma = prismaOf(app);
    for (let i = 0; i < 5; i++) {
      await prisma.callRecord.create({ data: { externalId: `c${i}`, direction: "INBOUND", fromNumber: "910000000", toNumber: "210000000", startedAt: new Date(`2026-11-0${i + 1}T10:00:00Z`) } });
    }
    const expected = (await prisma.callRecord.findMany({ orderBy: [{ startedAt: "desc" }, { id: "desc" }], select: { id: true } })).map((c) => c.id);
    expect((await walk("/zadarma/calls", { limit: 2 })).ids).toEqual(expected);
  });

  it("limites e cursores: limit fora de 1–100 dá 400; cursor inválido ou de outra lista devolve a primeira página", async () => {
    const prisma = prismaOf(app);
    for (let i = 0; i < 3; i++) await prisma.company.create({ data: { name: `E${i}` } });
    for (const path of ["/companies", "/contacts", "/tasks", "/email/messages", "/zadarma/calls"]) {
      await get(path, { limit: 0 }).expect(400);
      await get(path, { limit: 101 }).expect(400);
    }
    const first = (await get("/companies", { limit: 2 }).expect(200)).body;
    for (const cursor of ["lixo", Buffer.from("[1,2]").toString("base64url"), Buffer.from('["a"]').toString("base64url")]) {
      expect((await get("/companies", { limit: 2, cursor }).expect(200)).body).toEqual(first);
    }
  });
});
