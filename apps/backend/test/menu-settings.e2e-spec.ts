import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

// Fase 2c (docs/plano-fase-2-itens-de-trabalho.md): menu principal configurável pelo Administrador (decisão D5).
describe("Menu configurável (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
  });

  afterAll(async () => {
    await app.close();
  });

  const as = async (role: Role) => bearerFor(app, await createUser(prisma(), role));
  const put = (auth: string, entries: unknown[]) => api().put("/menu-settings").set("Authorization", auth).send({ entries });

  it("sem preferências devolve uma lista vazia (o frontend mostra o menu por omissão)", async () => {
    const res = await api().get("/menu-settings").set("Authorization", await as("LEITURA_APENAS")).expect(200);
    expect(res.body).toEqual({ entries: [], updatedAt: null });
    await api().get("/menu-settings").expect(401);
  });

  it("o Administrador grava (normalizado e auditado); todos leem o mesmo menu", async () => {
    const admin = await as("ADMINISTRADOR");
    const entries = [
      { type: "item", id: "core:dashboard" },
      { type: "group", id: "group:vendas", label: "  Vendas  " },
      { type: "item", id: "leads:leads", label: "Contactos novos", hidden: false },
      { type: "item", id: "deals:pipelines", hidden: true, extra: "ignorado" },
      { type: "item", id: "work-item-type:VISITA" },
    ];
    const saved = (await put(admin, entries).expect(200)).body;
    expect(saved.entries).toEqual([
      { type: "item", id: "core:dashboard" },
      { type: "group", id: "group:vendas", label: "Vendas" },
      { type: "item", id: "leads:leads", label: "Contactos novos" },
      { type: "item", id: "deals:pipelines", hidden: true },
      { type: "item", id: "work-item-type:VISITA" },
    ]);
    const read = (await api().get("/menu-settings").set("Authorization", await as("COMERCIAL")).expect(200)).body;
    expect(read.entries).toEqual(saved.entries);
    expect(await prisma().auditEvent.count({ where: { action: "menu_settings.updated" } })).toBe(1);

    // Gravar de novo substitui (não acumula); lista vazia = repor o menu por omissão.
    await put(admin, [{ type: "item", id: "core:tasks" }]).expect(200);
    await put(admin, []).expect(200);
    expect((await api().get("/menu-settings").set("Authorization", admin).expect(200)).body.entries).toEqual([]);
  });

  it("só o Administrador grava", async () => {
    for (const role of ["COMERCIAL", "TECNICO", "BACKOFFICE", "FINANCEIRO", "LEITURA_APENAS"] as Role[]) {
      await put(await as(role), [{ type: "item", id: "core:tasks" }]).expect(403);
    }
    expect(await prisma().menuSetting.count()).toBe(0);
  });

  it("valida as entradas: tipo, formato do id, nomes, repetidos e tamanho", async () => {
    const admin = await as("ADMINISTRADOR");
    await put(admin, [{ type: "link", id: "x" }]).expect(400);
    await put(admin, [{ type: "item", id: "tem espaço" }]).expect(400);
    await put(admin, [{ type: "item", id: "<script>" }]).expect(400);
    await put(admin, [{ type: "item", id: "a".repeat(121) }]).expect(400);
    await put(admin, [{ type: "group", id: "group:sem-nome" }]).expect(400);
    await put(admin, [{ type: "group", id: "group:vazio", label: "   " }]).expect(400);
    await put(admin, [{ type: "item", id: "core:tasks", label: "x".repeat(61) }]).expect(400);
    await put(admin, [{ type: "item", id: "core:tasks", hidden: "sim" }]).expect(400);
    const res = await put(admin, [{ type: "item", id: "core:tasks" }, { type: "group", id: "core:tasks", label: "G" }]).expect(400);
    expect(res.body.message).toContain("core:tasks");
    await put(admin, Array.from({ length: 201 }, (_, i) => ({ type: "item", id: `item:${i}` }))).expect(400);
    await api().put("/menu-settings").set("Authorization", admin).send({}).expect(400);
    expect(await prisma().menuSetting.count()).toBe(0);
  });

  it("tipos de tarefa: «aparece no menu» grava-se e lê-se (só o Administrador)", async () => {
    const admin = await as("ADMINISTRADOR");
    const before = (await api().get("/work-item-types").set("Authorization", admin).expect(200)).body;
    expect(before.every((t: { showInMenu: boolean }) => t.showInMenu === false)).toBe(true);

    await api().patch("/work-item-types/VISITA").set("Authorization", admin).send({ showInMenu: true }).expect(200);
    const comercial = await as("COMERCIAL");
    const after = (await api().get("/work-item-types").set("Authorization", comercial).expect(200)).body;
    expect(after.filter((t: { showInMenu: boolean }) => t.showInMenu).map((t: { id: string }) => t.id)).toEqual(["VISITA"]);
    await api().patch("/work-item-types/VISITA").set("Authorization", comercial).send({ showInMenu: false }).expect(403);
    await api().patch("/work-item-types/VISITA").set("Authorization", admin).send({ showInMenu: "sim" }).expect(400);
  });
});
