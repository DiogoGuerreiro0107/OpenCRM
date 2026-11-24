import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";

// Fase 6b (docs/plano-fase-6-encomendas.md): reservas de stock para as encomendas e saída de stock ao enviar.
describe("Reservas e saída de stock das encomendas (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let comercial: string;
  let companyId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    comercial = await bearerFor(app, await createUser(prisma(), "COMERCIAL", "Carla Comercial"));
    companyId = (await api().post("/companies").set("Authorization", admin).send({ name: "Gráfica São João" }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const newProduct = async (body: Record<string, unknown> = {}) =>
    (await api().post("/products").set("Authorization", admin).send({ sku: `p-${Math.random().toString(36).slice(2, 8)}`, name: "Toner preto", salePrice: 45.9, vatRate: 23, ...body }).expect(201)).body as { id: string; sku: string };
  const move = (productId: string, type: string, quantity: number) => api().post("/stock/movements").set("Authorization", admin).send({ productId, type, quantity, reason: "teste" }).expect(201);
  const product = async (id: string) => (await api().get(`/products/${id}`).set("Authorization", admin).expect(200)).body as { stockOnHand: number; reserved: number; available: number };
  /** Encomenda em rascunho com as linhas dadas (`[produto, quantidade]` ou avulsa). */
  const draft = async (lines: Array<[string, number] | "avulsa">) => {
    const order = (await api().post("/orders").set("Authorization", comercial).send({ companyId }).expect(201)).body as { id: string; code: string };
    for (const line of lines) {
      const body = line === "avulsa" ? { description: "Portes", quantity: 1, unitPrice: 5, vatRate: 23 } : { productId: line[0], quantity: line[1] };
      await api().post(`/orders/${order.id}/lines`).set("Authorization", comercial).send(body).expect(201);
    }
    return order;
  };
  const step = (id: string, action: string, body: Record<string, unknown> = {}) => api().post(`/orders/${id}/${action}`).set("Authorization", comercial).send(body);
  const confirmed = async (lines: Array<[string, number] | "avulsa">) => (await step((await draft(lines)).id, "confirm").expect(200)).body;
  const get = async (id: string) => (await api().get(`/orders/${id}`).set("Authorization", comercial).expect(200)).body;
  const reservedOf = async (id: string) => (await get(id)).lines.map((l: { reservedQuantity: number; waitingQuantity: number }) => [l.reservedQuantity, l.waitingQuantity]);
  const notes = async (id: string) => (await prisma().timelineEvent.findMany({ where: { entityType: "ORDER", entityId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((e) => e.description);
  const setModule = (id: string, enabled: boolean) => api().patch(`/modules/${id}`).set("Authorization", admin).send({ enabled }).expect(200);
  /** O reservado no produto é sempre a soma das linhas (trigger). */
  const assertReservedSum = async (productId: string) => {
    const sum = await prisma().salesOrderLine.aggregate({ where: { productId }, _sum: { reservedQuantity: true } });
    const row = await prisma().product.findUniqueOrThrow({ where: { id: productId } });
    expect(Number(row.reserved)).toBe(Number(sum._sum.reservedQuantity ?? 0));
  };

  it("confirmar reserva o disponível por linha: tudo, uma parte ou nada; avulsas e produtos sem stock não aguardam", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const service = await newProduct({ name: "Instalação", tracksStock: false });
    await move(toner.id, "INITIAL", 5);

    const a = await confirmed([[toner.id, 3], "avulsa", [service.id, 1]]);
    expect(a.lines.map((l: { reservedQuantity: number; waitingQuantity: number }) => [l.reservedQuantity, l.waitingQuantity])).toEqual([[3, 0], [0, 0], [0, 0]]);
    expect(a.waitingLines).toBe(0);
    expect(a.lines[0].product).toMatchObject({ stockOnHand: 5, reserved: 3, available: 2 });

    const b = await confirmed([[toner.id, 4]]);
    expect(b.lines[0]).toMatchObject({ reservedQuantity: 2, waitingQuantity: 2 });
    expect(b.waitingLines).toBe(1);
    const c = await confirmed([[toner.id, 1.5]]);
    expect(c.lines[0]).toMatchObject({ reservedQuantity: 0, waitingQuantity: 1.5 });

    expect(await product(toner.id)).toMatchObject({ stockOnHand: 5, reserved: 5, available: 0 });
    expect((await notes(a.id)).slice(-3)).toEqual(["Encomenda confirmada", "Stock reservado: 3 × Toner preto (TN-2420)", "Todo o stock da encomenda está reservado"]);
    expect((await notes(b.id)).slice(2)).toEqual(["Encomenda confirmada", "Stock reservado: 2 × Toner preto (TN-2420)", "A aguardar stock: 2 × Toner preto (TN-2420)"]);
    expect((await notes(c.id)).slice(2)).toEqual(["Encomenda confirmada", "A aguardar stock: 1,5 × Toner preto (TN-2420)"]);

    // Um rascunho não reserva, e o reservado não entra no stock: uma saída manual pode deixá-lo abaixo do reservado.
    const d = await draft([[toner.id, 1]]);
    expect((await get(d.id)).lines[0]).toMatchObject({ reservedQuantity: 0, waitingQuantity: 0, product: { available: 0 } });
    await move(toner.id, "SALE_OUT", 1);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 4, reserved: 5, available: -1 });
    expect(await reservedOf(a.id)).toEqual([[3, 0], [0, 0], [0, 0]]);

    // Deixar de controlar stock com reservas: recusado.
    await api().post("/stock/movements").set("Authorization", admin).send({ productId: toner.id, type: "ADJUSTMENT", countedQuantity: 0, reason: "contagem" }).expect(201);
    const res = await api().patch(`/products/${toner.id}`).set("Authorization", admin).send({ tracksStock: false }).expect(409);
    expect(res.body.message).toMatch(/reservado/);
    await assertReservedSum(toner.id);
  });

  it("entradas de stock servem as encomendas à espera pela ordem da confirmação; peças devolvidas também reservam", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const a = await confirmed([[toner.id, 2]]);
    const b = await confirmed([[toner.id, 3]]);
    expect(await reservedOf(a.id)).toEqual([[0, 2]]);

    // 3 entram: 2 para a mais antiga (fica completa), 1 para a seguinte.
    await move(toner.id, "INITIAL", 3);
    expect(await reservedOf(a.id)).toEqual([[2, 0]]);
    expect(await reservedOf(b.id)).toEqual([[1, 2]]);
    expect((await notes(a.id)).slice(-2)).toEqual(["Stock reservado: 2 × Toner preto (TN-2420)", "Todo o stock da encomenda está reservado"]);
    expect((await notes(b.id)).slice(-1)).toEqual(["Stock reservado: 1 × Toner preto (TN-2420)"]);

    // Uma devolução de 5 completa a segunda e sobram 3.
    await move(toner.id, "RETURN", 5);
    expect(await reservedOf(b.id)).toEqual([[3, 0]]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 8, reserved: 5, available: 3 });

    // Peça de uma assistência: tira 3 (nada a reservar); retirada, o stock volta e vai para uma encomenda à espera.
    const tecnico = await bearerFor(app, await createUser(prisma(), "TECNICO", "Rui Técnico"));
    const sc = (await api().post("/service-cases").set("Authorization", tecnico).send({ reportedProblem: "Não imprime" }).expect(201)).body;
    const part = (await api().post(`/service-cases/${sc.workItemId}/parts`).set("Authorization", tecnico).send({ productId: toner.id, quantity: 3 }).expect(201)).body;
    const c = await confirmed([[toner.id, 2]]);
    expect(await reservedOf(c.id)).toEqual([[0, 2]]);
    await api().delete(`/service-cases/${sc.workItemId}/parts/${part.id}`).set("Authorization", tecnico).expect(204);
    expect(await reservedOf(c.id)).toEqual([[2, 0]]);
    await assertReservedSum(toner.id);
  });

  it("enviar: recusa com linhas à espera, salvo «enviar mesmo assim»; lança as saídas e liberta as reservas", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const drum = await newProduct({ sku: "DR-2400", name: "Tambor" });
    const service = await newProduct({ name: "Instalação", tracksStock: false });
    await move(toner.id, "INITIAL", 10);
    await move(drum.id, "INITIAL", 1);

    const a = await confirmed([[toner.id, 4], [drum.id, 2], "avulsa", [service.id, 1]]);
    expect(a.waitingLines).toBe(1);
    const refused = await step(a.id, "ship").expect(409);
    expect(refused.body.message).toMatch(/aguardar stock \(1 × Tambor \(DR-2400\)\)/);
    expect((await get(a.id)).status).toBe("CONFIRMED");

    const shipped = (await step(a.id, "ship", { allowShortage: true }).expect(200)).body;
    expect(shipped.status).toBe("SHIPPED");
    expect(shipped.lines.map((l: { reservedQuantity: number }) => l.reservedQuantity)).toEqual([0, 0, 0, 0]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 6, reserved: 0, available: 6 });
    expect(await product(drum.id)).toMatchObject({ stockOnHand: -1, reserved: 0, available: -1 });

    const movements = await prisma().stockMovement.findMany({ where: { sourceType: "SALES_ORDER", sourceId: a.id }, orderBy: { quantity: "asc" } });
    expect(movements.map((m) => [m.productId, m.type, Number(m.quantity), m.reason])).toEqual([
      [toner.id, "SALE_OUT", -4, `${a.code}: encomenda enviada`],
      [drum.id, "SALE_OUT", -2, `${a.code}: encomenda enviada`],
    ]);
    expect((await notes(a.id)).slice(-3)).toEqual(["Encomenda enviada", "Saída de stock: 4 × Toner preto (TN-2420); 2 × Tambor (DR-2400)", "Enviada sem stock reservado para: 1 × Tambor (DR-2400)"]);
    const audit = await prisma().auditEvent.findFirstOrThrow({ where: { targetId: a.id, action: "order.shipped" } });
    expect(audit.metadata).toMatchObject({ allowShortage: true });

    // Com tudo reservado, envia sem perguntar; entregar não mexe no stock.
    const b = await confirmed([[toner.id, 6]]);
    await step(b.id, "ship").expect(200);
    await step(b.id, "deliver").expect(200);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 0, reserved: 0 });
    await assertReservedSum(toner.id);
    await assertReservedSum(drum.id);
  });

  it("cancelar liberta as reservas e o stock passa para a encomenda seguinte", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    await move(toner.id, "INITIAL", 3);
    const a = await confirmed([[toner.id, 3]]);
    const b = await confirmed([[toner.id, 2]]);
    expect(await reservedOf(b.id)).toEqual([[0, 2]]);

    await step(a.id, "cancel", { reason: "Cliente desistiu" }).expect(200);
    expect(await reservedOf(a.id)).toEqual([[0, 0]]);
    expect(await reservedOf(b.id)).toEqual([[2, 0]]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 3, reserved: 2, available: 1 });
    expect((await notes(a.id)).slice(-2)).toEqual(["Encomenda cancelada: Cliente desistiu", "Reservas libertadas: 3 × Toner preto (TN-2420)"]);
    expect((await notes(b.id)).slice(-2)).toEqual(["Stock reservado: 2 × Toner preto (TN-2420)", "Todo o stock da encomenda está reservado"]);
    await assertReservedSum(toner.id);
  });

  it("com o stock desligado não há reservas nem saídas; «Reservar stock» trata as confirmadas depois", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    await move(toner.id, "INITIAL", 5);
    await setModule("stock", false);

    const a = await confirmed([[toner.id, 2]]);
    expect(await notes(a.id)).not.toContain("A aguardar stock: 2 × Toner preto (TN-2420)");
    expect((await prisma().salesOrderLine.findFirstOrThrow({ where: { orderId: a.id } })).reservedQuantity.toNumber()).toBe(0);
    await step(a.id, "reserve").expect(400);
    const b = await confirmed([[toner.id, 1]]);
    await step(b.id, "ship").expect(200);
    expect(await prisma().stockMovement.count({ where: { sourceType: "SALES_ORDER" } })).toBe(0);

    // O stock volta: a encomenda aguarda até «Reservar stock».
    await setModule("stock", true);
    expect(await reservedOf(a.id)).toEqual([[0, 2]]);
    expect((await step(a.id, "reserve").expect(200)).body.lines[0]).toMatchObject({ reservedQuantity: 2, waitingQuantity: 0 });
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 5, reserved: 2, available: 3 });
    await step((await draft([[toner.id, 1]])).id, "reserve").expect(409);
    // Só quem escreve nas encomendas.
    const tecnico = await bearerFor(app, await createUser(prisma(), "TECNICO"));
    await api().post(`/orders/${a.id}/reserve`).set("Authorization", tecnico).expect(403);
    await assertReservedSum(toner.id);
  });

  it("concorrência: confirmações em simultâneo nunca reservam acima do disponível; entradas e cancelamentos ao mesmo tempo batem certo", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    await move(toner.id, "INITIAL", 3);
    const drafts = await Promise.all([1, 2, 3, 4].map(() => draft([[toner.id, 3]])));
    await Promise.all(drafts.map((d) => step(d.id, "confirm").expect(200)));
    const reserved = await prisma().salesOrderLine.findMany({ where: { productId: toner.id }, select: { reservedQuantity: true } });
    expect(reserved.map((l) => Number(l.reservedQuantity)).sort()).toEqual([0, 0, 0, 3]);
    expect(await product(toner.id)).toMatchObject({ reserved: 3, available: 0 });

    // A dona do stock cancela enquanto entram 4: no fim, 7 em stock e tudo reservado pelas três que restam (9 pedidas).
    const owner = (await prisma().salesOrderLine.findFirstOrThrow({ where: { productId: toner.id, reservedQuantity: 3 } })).orderId;
    await Promise.all([step(owner, "cancel", { reason: "Desistiu" }).expect(200), move(toner.id, "PURCHASE_IN", 2), move(toner.id, "PURCHASE_IN", 2)]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 7, reserved: 7, available: 0 });
    await assertReservedSum(toner.id);
  });

  it("lista: filtros «a aguardar stock» e por produto, com as linhas à espera; produtos com o reservado e o disponível", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const other = await newProduct({ sku: "XX-1" });
    await move(toner.id, "INITIAL", 2);
    const a = await confirmed([[toner.id, 2]]);
    const b = await confirmed([[toner.id, 1], [other.id, 1]]);
    const c = await draft([[other.id, 1]]);

    const waiting = (await api().get("/orders?waiting=true").set("Authorization", comercial).expect(200)).body.items;
    expect(waiting.map((o: { id: string; waitingLines: number }) => [o.id, o.waitingLines])).toEqual([[b.id, 2]]);
    const all = (await api().get("/orders").set("Authorization", comercial).expect(200)).body.items;
    expect(all.map((o: { id: string; waitingLines: number }) => [o.id, o.waitingLines])).toEqual([[c.id, 0], [b.id, 2], [a.id, 0]]);
    const byProduct = (await api().get(`/orders?productId=${other.id}`).set("Authorization", comercial).expect(200)).body.items;
    expect(byProduct.map((o: { id: string }) => o.id)).toEqual([c.id, b.id]);
    expect((await api().get(`/orders?productId=${toner.id}&waiting=true`).set("Authorization", comercial).expect(200)).body.items.map((o: { id: string }) => o.id)).toEqual([b.id]);

    const products = (await api().get("/products?search=TN-2420").set("Authorization", comercial).expect(200)).body.items;
    expect(products[0]).toMatchObject({ stockOnHand: 2, reserved: 2, available: 0 });
  });
});
