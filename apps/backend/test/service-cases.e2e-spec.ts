import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { SERVICE_STEPS } from "../src/service-cases/service-cases.service";

// Fase 4a (docs/plano-fase-4-assistencias.md): assistências = dados próprios dos itens de trabalho do tipo «Assistência».
describe("Assistências (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let tecnico: string;
  let tecnicoUser: { id: string };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    tecnicoUser = await createUser(prisma(), "TECNICO", "Rui Técnico");
    tecnico = await bearerFor(app, tecnicoUser as never);
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (body: Record<string, unknown>, auth = tecnico) => api().post("/service-cases").set("Authorization", auth).send(body);
  const list = async (query: Record<string, string>) => (await api().get("/service-cases").query(query).set("Authorization", tecnico).expect(200)).body;

  it("cria a tarefa do tipo «Assistência» no primeiro passo e os dados próprios, com número sequencial", async () => {
    const company = await prisma().company.create({ data: { name: "Gráfica São João" } });
    const res = (await create({ reportedProblem: "A impressora encrava o papel na bandeja 2", brand: " HP ", model: "LaserJet 4250", serialNumber: "CNB123", underWarranty: "NO", companyId: company.id }).expect(201)).body;
    expect(res).toMatchObject({ code: "AS-0001", brand: "HP", underWarranty: "NO", reportedProblem: "A impressora encrava o papel na bandeja 2" });
    expect(res.workItem).toMatchObject({ typeId: "ASSISTENCIA", title: "A impressora encrava o papel na bandeja 2", status: "PENDING", step: { name: "Recebida" }, assignee: { id: tecnicoUser.id }, company: { id: company.id } });
    // Os passos por omissão foram dados ao tipo.
    const type = (await api().get("/work-item-types").set("Authorization", admin).expect(200)).body.find((t: { id: string }) => t.id === "ASSISTENCIA");
    expect(type.steps.map((s: { name: string }) => s.name)).toEqual(SERVICE_STEPS.map((s) => s.name));

    // Números sem repetir, também em criações simultâneas.
    const many = await Promise.all(Array.from({ length: 5 }, (_, i) => create({ reportedProblem: `Problema ${i}` }).expect(201)));
    const codes = many.map((r) => r.body.code);
    expect(new Set(codes).size).toBe(5);
    expect(codes.every((c: string) => /^AS-000[2-6]$/.test(c))).toBe(true);

    await create({ reportedProblem: "   " }).expect(400);
    await create({}).expect(400);
  });

  it("não pisa os passos que o administrador já deu ao tipo", async () => {
    const custom = (await api().post("/work-item-types/ASSISTENCIA/workflow").set("Authorization", admin).expect(201)).body;
    const res = (await create({ reportedProblem: "Ecrã partido" }).expect(201)).body;
    expect(res.workItem.step.id).toBe(custom.steps[0].id);
    const type = (await api().get("/work-item-types").set("Authorization", admin).expect(200)).body.find((t: { id: string }) => t.id === "ASSISTENCIA");
    expect(type.steps.map((s: { name: string }) => s.name)).toEqual(["Por fazer", "Em curso", "Concluída", "Cancelada"]);
  });

  it("editar: diagnóstico e resolução vão à timeline; o problema não fica vazio; a assistência não muda de tipo", async () => {
    const { workItemId: id } = (await create({ reportedProblem: "Não liga" }).expect(201)).body;
    await api().patch(`/service-cases/${id}`).set("Authorization", tecnico).send({ diagnosis: "Fonte queimada", serialNumber: "XYZ" }).expect(200);
    await api().patch(`/service-cases/${id}`).set("Authorization", tecnico).send({ diagnosis: null, resolution: "Fonte substituída" }).expect(200);
    await api().patch(`/service-cases/${id}`).set("Authorization", tecnico).send({ reportedProblem: " " }).expect(400);
    const events = await prisma().timelineEvent.findMany({ where: { entityType: "TASK", entityId: id }, orderBy: { createdAt: "asc" } });
    // O 2.º pedido grava as duas notas juntas (mesma hora): a ordem entre elas não conta.
    const descriptions = events.map((e) => e.description);
    expect(descriptions[0]).toBe("Diagnóstico atualizado: Fonte queimada");
    expect(descriptions.slice(1).sort()).toEqual(["Diagnóstico apagado.", "Resolução atualizada: Fonte substituída"]);
    expect((await api().get(`/service-cases/${id}`).set("Authorization", tecnico).expect(200)).body).toMatchObject({ serialNumber: "XYZ", diagnosis: null, resolution: "Fonte substituída" });

    await api().patch(`/tasks/${id}`).set("Authorization", tecnico).send({ typeId: "VISITA" }).expect(400);
    await api().patch(`/tasks/${id}`).set("Authorization", tecnico).send({ title: "Não liga (urgente)" }).expect(200);
  });

  it("lista: pesquisa por número, série, marca e cliente; em aberto e fechadas; por empresa; paginada", async () => {
    const acme = await prisma().company.create({ data: { name: "Acme Lda" } });
    const a = (await create({ reportedProblem: "Encrava", brand: "Brother", serialNumber: "SER-AAA", companyId: acme.id }).expect(201)).body;
    const b = (await create({ reportedProblem: "Não imprime", brand: "Epson", serialNumber: "SER-BBB" }).expect(201)).body;
    const c = (await create({ reportedProblem: "Risca", brand: "HP" }).expect(201)).body;
    const ids = (body: { items: Array<{ workItemId: string }> }) => body.items.map((i) => i.workItemId);

    expect(ids(await list({ search: "AS-0002" }))).toEqual([b.workItemId]);
    expect(ids(await list({ search: "2" }))).toEqual([b.workItemId]);
    expect(ids(await list({ search: "ser-aaa" }))).toEqual([a.workItemId]);
    expect(ids(await list({ search: "epson" }))).toEqual([b.workItemId]);
    expect(ids(await list({ search: "acme" }))).toEqual([a.workItemId]);
    expect(ids(await list({ companyId: acme.id }))).toEqual([a.workItemId]);

    const resolved = (await api().get("/work-item-types").set("Authorization", admin).expect(200)).body.find((t: { id: string }) => t.id === "ASSISTENCIA").steps.find((s: { name: string }) => s.name === "Resolvida");
    await api().patch(`/tasks/${c.workItemId}`).set("Authorization", tecnico).send({ stepId: resolved.id }).expect(200);
    expect(ids(await list({ state: "closed" }))).toEqual([c.workItemId]);
    expect(ids(await list({ state: "open" })).sort()).toEqual([a.workItemId, b.workItemId].sort());
    expect(ids(await list({ stepId: resolved.id }))).toEqual([c.workItemId]);

    const page = await list({ limit: "2" });
    expect(ids(page)).toEqual([c.workItemId, b.workItemId]);
    expect(ids(await list({ limit: "2", cursor: page.nextCursor }))).toEqual([a.workItemId]);
  });

  it("apagar a tarefa apaga a assistência", async () => {
    const { workItemId: id } = (await create({ reportedProblem: "Teste" }).expect(201)).body;
    await api().delete(`/tasks/${id}`).set("Authorization", tecnico).expect(204);
    expect(await prisma().serviceCase.count()).toBe(0);
  });

  it("permissões: Leitura apenas consulta mas não cria nem altera", async () => {
    const reader = await bearerFor(app, await createUser(prisma(), "LEITURA_APENAS"));
    const { workItemId: id } = (await create({ reportedProblem: "Teste" }).expect(201)).body;
    await api().get(`/service-cases/${id}`).set("Authorization", reader).expect(200);
    await api().get("/service-cases").set("Authorization", reader).expect(200);
    await create({ reportedProblem: "x" }, reader).expect(403);
    await api().patch(`/service-cases/${id}`).set("Authorization", reader).send({ diagnosis: "x" }).expect(403);
    await api().get("/service-cases").expect(401);
  });

  it("módulo desligado: 404, a tarefa continua e os dados ficam para quando voltar", async () => {
    const { workItemId: id } = (await create({ reportedProblem: "Teste", brand: "HP" }).expect(201)).body;
    await api().patch("/modules/assistencias").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().get("/service-cases").set("Authorization", tecnico).expect(404);
    await api().get(`/service-cases/${id}`).set("Authorization", tecnico).expect(404);
    await create({ reportedProblem: "x" }).expect(404);
    await api().get(`/tasks/${id}`).set("Authorization", tecnico).expect(200);
    await api().patch("/modules/assistencias").set("Authorization", admin).send({ enabled: true }).expect(200);
    expect((await api().get(`/service-cases/${id}`).set("Authorization", tecnico).expect(200)).body.brand).toBe("HP");
  });

  it("automações: a garantia e a marca entram nas condições, já no «criado» e ao mudar", async () => {
    await api()
      .post("/automation-rules")
      .set("Authorization", admin)
      .send({
        name: "Orçamento se não houver garantia",
        entityType: "WORK_ITEM",
        trigger: "CREATED",
        conditions: [{ field: "typeId", operator: "eq", value: "ASSISTENCIA" }, { field: "underWarranty", operator: "eq", value: "NO" }],
        action: "CREATE_WORK_ITEM",
        actionConfig: { typeId: "PROPOSTA", title: "Orçamento: {titulo}", assignee: { mode: "OWNER" } },
      })
      .expect(201);
    await api()
      .post("/automation-rules")
      .set("Authorization", admin)
      .send({ name: "Garantia mudou", entityType: "WORK_ITEM", trigger: "FIELD_CHANGED", triggerConfig: { field: "underWarranty" }, action: "WEBHOOK", actionConfig: { event: "automation.garantia" } })
      .expect(201);

    await create({ title: "Impressora A", reportedProblem: "x", underWarranty: "NO" }).expect(201);
    const yes = (await create({ title: "Impressora B", reportedProblem: "x", underWarranty: "YES" }).expect(201)).body;
    expect((await prisma().workItem.findMany({ where: { typeId: "PROPOSTA" } })).map((t) => t.title)).toEqual(["Orçamento: Impressora A"]);

    await api().patch(`/service-cases/${yes.workItemId}`).set("Authorization", tecnico).send({ underWarranty: "UNKNOWN" }).expect(200);
    const runs = await prisma().automationRun.findMany({ where: { trigger: "FIELD_CHANGED" } });
    expect(runs.map((r) => [r.entityId, r.outcome])).toEqual([[yes.workItemId, "SUCCEEDED"]]);
  });

  it("uma tarefa do tipo «Assistência» criada fora da ficha (ou que passa a esse tipo) também tem os dados próprios", async () => {
    const viaTask = (await api().post("/tasks").set("Authorization", tecnico).send({ title: "Fotocopiadora parada", description: "  Encrava no tabuleiro 2  ", typeId: "ASSISTENCIA" }).expect(201)).body;
    const sc = (await api().get(`/service-cases/${viaTask.id}`).set("Authorization", tecnico).expect(200)).body;
    expect(sc.reportedProblem).toBe("Encrava no tabuleiro 2");
    expect(sc.underWarranty).toBe("UNKNOWN");

    const plain = (await api().post("/tasks").set("Authorization", tecnico).send({ title: "Ver toner" }).expect(201)).body;
    await api().get(`/service-cases/${plain.id}`).set("Authorization", tecnico).expect(404);
    await api().patch(`/tasks/${plain.id}`).set("Authorization", tecnico).send({ title: "Ver toner (renomeada)" }).expect(200);
    await api().get(`/service-cases/${plain.id}`).set("Authorization", tecnico).expect(404);
    await api().patch(`/tasks/${plain.id}`).set("Authorization", tecnico).send({ typeId: "ASSISTENCIA" }).expect(200);
    expect((await api().get(`/service-cases/${plain.id}`).set("Authorization", tecnico).expect(200)).body.reportedProblem).toBe("Ver toner (renomeada)");

    // Pela ficha, os dados são os do pedido (não os substitui a regra genérica).
    const { workItemId } = (await create({ reportedProblem: "Não liga", brand: "Kyocera" }).expect(201)).body;
    expect(await prisma().serviceCase.count({ where: { workItemId } })).toBe(1);
    expect((await prisma().serviceCase.findUniqueOrThrow({ where: { workItemId } })).brand).toBe("Kyocera");
    // Números seguidos, sem buracos, venham de onde vierem.
    const codes = (await list({})).items.map((c: { code: string }) => c.code).sort();
    expect(codes).toEqual(["AS-0001", "AS-0002", "AS-0003"]);
  });
});
