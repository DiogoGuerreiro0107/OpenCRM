import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";

// Fase 5c (docs/plano-fase-5-produtos-stock.md): peças das assistências escolhidas do catálogo e a gastar stock.
describe("Peças ligadas a produtos e ao stock (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let rui: string;
  let ruiUser: { id: string };

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    // Técnico: escreve nas peças (Trabalho diário), mas não tem a área «Movimentos de stock».
    ruiUser = await createUser(prisma(), "TECNICO", "Rui Técnico");
    rui = await bearerFor(app, ruiUser as never);
  });

  afterAll(async () => {
    await app.close();
  });

  const newCase = async () => (await api().post("/service-cases").set("Authorization", rui).send({ reportedProblem: "Não imprime" }).expect(201)).body as { workItemId: string; code: string };
  const newProduct = async (body: Record<string, unknown> = {}) =>
    (await api().post("/products").set("Authorization", admin).send({ sku: `p-${Math.random().toString(36).slice(2, 8)}`, name: "Toner preto", ...body }).expect(201)).body as { id: string; sku: string; name: string };
  const stockIn = (productId: string, quantity: number) => api().post("/stock/movements").set("Authorization", admin).send({ productId, type: "INITIAL", quantity }).expect(201);
  const stockOf = async (id: string) => (await api().get(`/products/${id}`).set("Authorization", admin).expect(200)).body.stockOnHand as number;
  const parts = (id: string) => `/service-cases/${id}/parts`;
  const partMovements = (productId: string) => prisma().stockMovement.findMany({ where: { productId, type: "SERVICE_PART" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const setModule = (id: string, enabled: boolean) => api().patch(`/modules/${id}`).set("Authorization", admin).send({ enabled }).expect(200);

  it("do catálogo: a descrição e a referência vêm do produto (editáveis); produto inativo, inexistente ou produtos desligados → 400", async () => {
    const { workItemId: id } = await newCase();
    const p = await newProduct({ tracksStock: false });
    const a = (await api().post(parts(id)).set("Authorization", rui).send({ productId: p.id, quantity: 2 }).expect(201)).body;
    expect(a).toMatchObject({ productId: p.id, description: "Toner preto", reference: p.sku, quantity: 2, stockTaken: 0, product: { id: p.id, sku: p.sku, tracksStock: false } });
    const b = (await api().post(parts(id)).set("Authorization", rui).send({ productId: p.id, description: "Toner preto (recondicionado)", reference: "" }).expect(201)).body;
    expect(b).toMatchObject({ description: "Toner preto (recondicionado)", reference: null });
    // A peça avulsa continua a pedir a descrição.
    await api().post(parts(id)).set("Authorization", rui).send({ quantity: 1 }).expect(400);

    await api().post(parts(id)).set("Authorization", rui).send({ productId: "nao-existe" }).expect(400);
    const off = await newProduct();
    await api().patch(`/products/${off.id}`).set("Authorization", admin).send({ active: false }).expect(200);
    await api().post(parts(id)).set("Authorization", rui).send({ productId: off.id }).expect(400);

    await setModule("stock", false);
    await setModule("produtos", false);
    await api().post(parts(id)).set("Authorization", rui).send({ productId: p.id }).expect(400);
    // As peças já ligadas continuam a ver-se e a editar-se.
    await api().patch(`${parts(id)}/${a.id}`).set("Authorization", rui).send({ quantity: 3 }).expect(200);
    expect((await api().get(parts(id)).set("Authorization", rui).expect(200)).body).toHaveLength(2);
  });

  it("com o stock: adicionar tira, mudar a quantidade tira ou devolve a diferença (nunca mais do que tirou), retirar devolve", async () => {
    const { workItemId: id, code } = await newCase();
    const p = await newProduct();
    await stockIn(p.id, 10);

    const part = (await api().post(parts(id)).set("Authorization", rui).send({ productId: p.id, quantity: 2 }).expect(201)).body;
    expect(part).toMatchObject({ stockTaken: 2, product: { stockOnHand: 8 } });
    expect(await stockOf(p.id)).toBe(8);

    await api().patch(`${parts(id)}/${part.id}`).set("Authorization", rui).send({ quantity: 3.5 }).expect(200);
    expect(await stockOf(p.id)).toBe(6.5);
    // Só a descrição: não mexe no stock.
    await api().patch(`${parts(id)}/${part.id}`).set("Authorization", rui).send({ description: "Toner preto XL" }).expect(200);
    const down = (await api().patch(`${parts(id)}/${part.id}`).set("Authorization", rui).send({ quantity: 1 }).expect(200)).body;
    expect(down).toMatchObject({ quantity: 1, stockTaken: 1 });
    expect(await stockOf(p.id)).toBe(9);

    await api().delete(`${parts(id)}/${part.id}`).set("Authorization", rui).expect(204);
    expect(await stockOf(p.id)).toBe(10);

    const movements = await partMovements(p.id);
    expect(movements.map((m) => Number(m.quantity))).toEqual([-2, -1.5, 2.5, 1]);
    for (const m of movements) expect(m).toMatchObject({ sourceType: "SERVICE_CASE", sourceId: id, userId: ruiUser.id });
    expect(movements.map((m) => m.reason)).toEqual([`${code}: peça adicionada`, `${code}: quantidade da peça alterada`, `${code}: quantidade da peça alterada`, `${code}: peça retirada`]);

    // Adicionada com o stock desligado (não tirou nada): baixar a quantidade depois de o religar não devolve o que
    // nunca saiu, e subir tira só a diferença.
    await setModule("stock", false);
    const late = (await api().post(parts(id)).set("Authorization", rui).send({ productId: p.id, quantity: 4 }).expect(201)).body;
    expect(late.stockTaken).toBe(0);
    expect(await prisma().stockMovement.count({ where: { productId: p.id } })).toBe(5);
    await setModule("stock", true);
    await api().patch(`${parts(id)}/${late.id}`).set("Authorization", rui).send({ quantity: 2 }).expect(200);
    expect(await stockOf(p.id)).toBe(10);
    expect((await api().patch(`${parts(id)}/${late.id}`).set("Authorization", rui).send({ quantity: 5 }).expect(200)).body.stockTaken).toBe(3);
    expect(await stockOf(p.id)).toBe(7);
    // Com o stock desligado, retirar não devolve (fica para o acerto de contagem).
    await setModule("stock", false);
    await api().delete(`${parts(id)}/${late.id}`).set("Authorization", rui).expect(204);
    await setModule("stock", true);
    expect(await stockOf(p.id)).toBe(7);
  });

  it("produto que não controla stock: nada se lança", async () => {
    const { workItemId: id } = await newCase();
    const p = await newProduct({ tracksStock: false });
    const part = (await api().post(parts(id)).set("Authorization", rui).send({ productId: p.id, quantity: 2 }).expect(201)).body;
    await api().patch(`${parts(id)}/${part.id}`).set("Authorization", rui).send({ quantity: 5 }).expect(200);
    await api().delete(`${parts(id)}/${part.id}`).set("Authorization", rui).expect(204);
    expect(await prisma().stockMovement.count({ where: { productId: p.id } })).toBe(0);
  });

  it("alterações simultâneas à mesma peça não se pisam", async () => {
    const { workItemId: id } = await newCase();
    const p = await newProduct();
    await stockIn(p.id, 50);
    const part = (await api().post(parts(id)).set("Authorization", rui).send({ productId: p.id, quantity: 1 }).expect(201)).body;
    await Promise.all([2, 3, 4, 5, 6].map((quantity) => api().patch(`${parts(id)}/${part.id}`).set("Authorization", rui).send({ quantity }).expect(200)));
    const final = await prisma().servicePart.findUniqueOrThrow({ where: { id: part.id } });
    // O que a peça tirou é sempre a quantidade final, e o stock bate certo.
    expect(Number(final.stockTaken)).toBe(Number(final.quantity));
    expect(await stockOf(p.id)).toBe(50 - Number(final.quantity));
  });

  it("apagar a tarefa com peças que tiraram stock → 409; apagar o produto usado em peças → 409", async () => {
    const { workItemId: id } = await newCase();
    const p = await newProduct();
    await stockIn(p.id, 5);
    const part = (await api().post(parts(id)).set("Authorization", rui).send({ productId: p.id }).expect(201)).body;
    await api().delete(`/tasks/${id}`).set("Authorization", admin).expect(409);
    await api().delete(`/products/${p.id}`).set("Authorization", admin).expect(409);

    // Sem stock tirado, a tarefa apaga-se (e a peça vai com ela); o produto já não tem peças, mas tem movimentos.
    await api().delete(`${parts(id)}/${part.id}`).set("Authorization", rui).expect(204);
    await api().delete(`/tasks/${id}`).set("Authorization", admin).expect(204);

    const unused = await newProduct({ tracksStock: false });
    const other = await newCase();
    await api().post(parts(other.workItemId)).set("Authorization", rui).send({ productId: unused.id }).expect(201);
    const response = await api().delete(`/products/${unused.id}`).set("Authorization", admin).expect(409);
    expect(response.body.message).toContain("peças de assistências");

    // A base de dados também o garante: só uma peça do catálogo tira stock, e nunca negativo.
    await expect(prisma().$executeRawUnsafe(`UPDATE "ServicePart" SET "stockTaken" = -1 WHERE "serviceCaseId" = '${other.workItemId}'`)).rejects.toThrow(/ServicePart_stock_tirado/);
    await expect(prisma().$executeRawUnsafe(`UPDATE "ServicePart" SET "productId" = NULL, "stockTaken" = 1 WHERE "serviceCaseId" = '${other.workItemId}'`)).rejects.toThrow(/ServicePart_stock_tirado/);
  });

  it("peças mais usadas agrupadas pelo produto (com o nome atual); as avulsas pela descrição", async () => {
    const a = await newCase();
    const b = await newCase();
    const p = await newProduct({ name: "Fusor", tracksStock: false });
    await api().post(parts(a.workItemId)).set("Authorization", rui).send({ productId: p.id, quantity: 2, description: "Fusor (usado)" }).expect(201);
    await api().post(parts(b.workItemId)).set("Authorization", rui).send({ productId: p.id, quantity: 1 }).expect(201);
    await api().post(parts(b.workItemId)).set("Authorization", rui).send({ description: "Fusor", quantity: 1 }).expect(201);
    await api().patch(`/products/${p.id}`).set("Authorization", admin).send({ name: "Fusor 220V" }).expect(200);

    const { topParts } = (await api().get("/service-cases/indicators").set("Authorization", admin).expect(200)).body;
    expect(topParts).toEqual([
      { productId: p.id, description: "Fusor 220V", reference: p.sku, quantity: 3, cases: 2 },
      { productId: null, description: "Fusor", reference: null, quantity: 1, cases: 1 },
    ]);
  });
});
