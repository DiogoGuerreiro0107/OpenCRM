import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { Role } from "@prisma/client";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";

// Fase 5b (docs/plano-fase-5-produtos-stock.md): stock como livro de movimentos.
describe("Stock (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let adminId: string;
  const as = async (role: Role) => bearerFor(app, await createUser(prisma(), role));

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    const user = await createUser(prisma(), "ADMINISTRADOR");
    adminId = user.id;
    admin = await bearerFor(app, user);
  });

  afterAll(async () => {
    await app.close();
  });

  const newProduct = async (body: Record<string, unknown> = {}) =>
    (await api().post("/products").set("Authorization", admin).send({ sku: `P-${Math.random().toString(36).slice(2, 8)}`, name: "Produto", ...body }).expect(201)).body as { id: string };
  const move = (body: Record<string, unknown>, auth = admin) => api().post("/stock/movements").set("Authorization", auth).send(body);
  const stockOf = async (id: string) => (await api().get(`/products/${id}`).set("Authorization", admin).expect(200)).body.stockOnHand as number;

  it("tipos e sinais: inicial, entrada, saída, devolução; o stock atual é a soma e pode ficar negativo", async () => {
    const p = await newProduct();
    const initial = (await move({ productId: p.id, type: "INITIAL", quantity: 10 }).expect(201)).body;
    expect(initial).toMatchObject({ movement: { type: "INITIAL", quantity: 10, product: { id: p.id }, user: { id: adminId } }, stockOnHand: 10, belowMin: false });
    await move({ productId: p.id, type: "PURCHASE_IN", quantity: 5.5, note: "Fatura 123" }).expect(201);
    expect((await move({ productId: p.id, type: "SALE_OUT", quantity: 3 }).expect(201)).body.movement.quantity).toBe(-3);
    await move({ productId: p.id, type: "RETURN", quantity: 1 }).expect(201);
    expect(await stockOf(p.id)).toBe(13.5);
    expect((await move({ productId: p.id, type: "SALE_OUT", quantity: 20 }).expect(201)).body.stockOnHand).toBe(-6.5);

    // Igual à soma dos movimentos.
    const sum = await prisma().stockMovement.aggregate({ where: { productId: p.id }, _sum: { quantity: true } });
    expect(Number(sum._sum.quantity)).toBe(-6.5);

    // Validações.
    for (const bad of [{ type: "PURCHASE_IN" }, { type: "PURCHASE_IN", quantity: 0 }, { type: "PURCHASE_IN", quantity: -2 }, { type: "PURCHASE_IN", quantity: 1.234 }, { type: "SERVICE_PART", quantity: 1 }, { type: "NOPE", quantity: 1 }]) {
      await move({ productId: p.id, ...bad }).expect(400);
    }
    await move({ productId: "nao-existe", type: "PURCHASE_IN", quantity: 1 }).expect(404);
  });

  it("stock inicial só antes de qualquer outro movimento; acerto pela contagem, com motivo", async () => {
    const p = await newProduct();
    await move({ productId: p.id, type: "PURCHASE_IN", quantity: 4 }).expect(201);
    await move({ productId: p.id, type: "INITIAL", quantity: 10 }).expect(409);

    await move({ productId: p.id, type: "ADJUSTMENT", countedQuantity: 7 }).expect(400);
    await move({ productId: p.id, type: "ADJUSTMENT", reason: "Inventário" }).expect(400);
    await move({ productId: p.id, type: "ADJUSTMENT", countedQuantity: 4, reason: "Inventário" }).expect(400);
    await move({ productId: p.id, type: "ADJUSTMENT", countedQuantity: -1, reason: "Inventário" }).expect(400);
    const adj = (await move({ productId: p.id, type: "ADJUSTMENT", countedQuantity: 2.5, reason: " Inventário de novembro " }).expect(201)).body;
    expect(adj).toMatchObject({ movement: { type: "ADJUSTMENT", quantity: -1.5, reason: "Inventário de novembro" }, stockOnHand: 2.5 });
    expect((await move({ productId: p.id, type: "ADJUSTMENT", countedQuantity: 6, reason: "Achados" }).expect(201)).body.movement.quantity).toBe(3.5);
  });

  it("acertos e entradas ao mesmo tempo não se pisam (a linha do produto é bloqueada)", async () => {
    const p = await newProduct();
    await move({ productId: p.id, type: "INITIAL", quantity: 100 }).expect(201);
    await Promise.all(Array.from({ length: 8 }, () => move({ productId: p.id, type: "SALE_OUT", quantity: 1 }).expect(201)));
    expect(await stockOf(p.id)).toBe(92);
    // Duas contagens iguais em simultâneo: uma lança a diferença, a outra já encontra o stock certo.
    const results = await Promise.all([move({ productId: p.id, type: "ADJUSTMENT", countedQuantity: 90, reason: "A" }), move({ productId: p.id, type: "ADJUSTMENT", countedQuantity: 90, reason: "B" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await stockOf(p.id)).toBe(90);
  });

  it("só produtos que controlam stock; com movimentos não se apaga; deixar de controlar só com stock a zero", async () => {
    const service = await newProduct({ tracksStock: false });
    await move({ productId: service.id, type: "PURCHASE_IN", quantity: 1 }).expect(400);

    const p = await newProduct();
    await move({ productId: p.id, type: "PURCHASE_IN", quantity: 2 }).expect(201);
    await api().delete(`/products/${p.id}`).set("Authorization", admin).expect(409);
    await api().patch(`/products/${p.id}`).set("Authorization", admin).send({ tracksStock: false }).expect(409);
    await move({ productId: p.id, type: "ADJUSTMENT", countedQuantity: 0, reason: "Fim" }).expect(201);
    await api().patch(`/products/${p.id}`).set("Authorization", admin).send({ tracksStock: false }).expect(200);
    await api().patch(`/products/${p.id}`).set("Authorization", admin).send({ active: false }).expect(200);
  });

  it("imutável: a base de dados recusa alterar e apagar movimentos", async () => {
    const p = await newProduct();
    const m = (await move({ productId: p.id, type: "PURCHASE_IN", quantity: 3 }).expect(201)).body.movement;
    await expect(prisma().stockMovement.update({ where: { id: m.id }, data: { quantity: 30 } })).rejects.toThrow(/só de acrescentar/);
    await expect(prisma().stockMovement.delete({ where: { id: m.id } })).rejects.toThrow(/só de acrescentar/);
    // Sinal errado também é recusado pela base de dados.
    await expect(prisma().stockMovement.create({ data: { productId: p.id, type: "SALE_OUT", quantity: 2, userId: adminId } })).rejects.toThrow();
    await expect(prisma().stockMovement.create({ data: { productId: p.id, type: "ADJUSTMENT", quantity: 0, userId: adminId } })).rejects.toThrow();
    expect(await stockOf(p.id)).toBe(3);
  });

  it("alertas: abaixo do mínimo e negativo (filtros e contagens); histórico paginado e filtrado", async () => {
    const low = await newProduct({ name: "Baixo", minStock: 5 });
    const ok = await newProduct({ name: "Bem", minStock: 2 });
    const neg = await newProduct({ name: "Negativo" });
    await newProduct({ name: "Sem mínimo" });
    expect((await api().get(`/products/${low.id}`).set("Authorization", admin).expect(200)).body.belowMin).toBe(true);
    await move({ productId: low.id, type: "INITIAL", quantity: 3 }).expect(201);
    await move({ productId: ok.id, type: "INITIAL", quantity: 3 }).expect(201);
    await move({ productId: neg.id, type: "SALE_OUT", quantity: 1 }).expect(201);

    const names = async (stock: string) => (await api().get("/products").query({ stock }).set("Authorization", admin).expect(200)).body.items.map((p: { name: string }) => p.name);
    expect(await names("below_min")).toEqual(["Baixo"]);
    expect(await names("negative")).toEqual(["Negativo"]);
    expect((await api().get("/stock/summary").set("Authorization", admin).expect(200)).body).toEqual({ belowMin: 1, negative: 1 });

    // Subir o mínimo também conta; repor stock tira do alerta.
    await api().patch(`/products/${ok.id}`).set("Authorization", admin).send({ minStock: 10 }).expect(200);
    expect(await names("below_min")).toEqual(["Baixo", "Bem"]);
    await move({ productId: low.id, type: "PURCHASE_IN", quantity: 10 }).expect(201);
    expect(await names("below_min")).toEqual(["Bem"]);
    // Desativados não contam.
    await api().patch(`/products/${ok.id}`).set("Authorization", admin).send({ active: false }).expect(200);
    expect((await api().get("/stock/summary").set("Authorization", admin).expect(200)).body).toEqual({ belowMin: 0, negative: 1 });

    const page = (await api().get("/stock/movements").query({ productId: low.id, limit: "1" }).set("Authorization", admin).expect(200)).body;
    expect(page.items.map((m: { type: string }) => m.type)).toEqual(["PURCHASE_IN"]);
    const rest = (await api().get("/stock/movements").query({ productId: low.id, limit: "1", cursor: page.nextCursor }).set("Authorization", admin).expect(200)).body;
    expect(rest.items.map((m: { type: string }) => m.type)).toEqual(["INITIAL"]);
    expect((await api().get("/stock/movements").query({ type: "SALE_OUT" }).set("Authorization", admin).expect(200)).body.items).toHaveLength(1);
  });

  it("permissões e módulo (que depende dos produtos)", async () => {
    const p = await newProduct();
    for (const role of ["TECNICO", "COMERCIAL", "FINANCEIRO", "LEITURA_APENAS"] as Role[]) {
      const auth = await as(role);
      await move({ productId: p.id, type: "PURCHASE_IN", quantity: 1 }, auth).expect(403);
      await api().get("/stock/movements").set("Authorization", auth).expect(200);
    }
    await move({ productId: p.id, type: "PURCHASE_IN", quantity: 1 }, await as("BACKOFFICE")).expect(201);

    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().get("/stock/summary").set("Authorization", admin).expect(404);
    await api().get(`/products/${p.id}`).set("Authorization", admin).expect(200);
    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: true }).expect(200);
    // Sem produtos, o stock não se liga.
    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().patch("/modules/encomendas").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().patch("/modules/produtos").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: true }).expect(400);
  });
});
