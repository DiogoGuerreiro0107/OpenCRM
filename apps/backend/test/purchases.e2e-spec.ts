import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";
import { OrderPreparationService } from "../src/orders/order-preparation.service";

// Fase 6c (docs/plano-fase-6-encomendas.md): compras a fornecedor, receção para o stock, sugestões a partir das
// encomendas e a tarefa «Preparar encomenda».
describe("Compras a fornecedor (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let backoffice: string;
  let comercial: string;
  let tecnico: string;
  let backofficeId: string;
  let comercialId: string;
  let companyId: string;
  let s1: string;
  let s2: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    const bo = await createUser(prisma(), "BACKOFFICE", "Bruno Backoffice");
    backofficeId = bo.id;
    backoffice = await bearerFor(app, bo);
    const co = await createUser(prisma(), "COMERCIAL", "Carla Comercial");
    comercialId = co.id;
    comercial = await bearerFor(app, co);
    tecnico = await bearerFor(app, await createUser(prisma(), "TECNICO"));
    companyId = (await api().post("/companies").set("Authorization", admin).send({ name: "Gráfica São João" }).expect(201)).body.id;
    s1 = (await api().post("/companies").set("Authorization", admin).send({ name: "Distribuidora Norte", isSupplier: true }).expect(201)).body.id;
    s2 = (await api().post("/companies").set("Authorization", admin).send({ name: "Papelaria Sul", isSupplier: true }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const newProduct = async (body: Record<string, unknown> = {}) =>
    (await api().post("/products").set("Authorization", admin).send({ sku: `p-${Math.random().toString(36).slice(2, 8)}`, name: "Toner preto", salePrice: 45.9, vatRate: 23, ...body }).expect(201)).body as { id: string; sku: string };
  const link = (productId: string, supplierId: string, body: Record<string, unknown> = {}) =>
    api().post(`/products/${productId}/suppliers`).set("Authorization", admin).send({ companyId: supplierId, ...body }).expect(201);
  const move = (productId: string, type: string, quantity: number) => api().post("/stock/movements").set("Authorization", admin).send({ productId, type, quantity, reason: "teste" }).expect(201);
  const product = async (id: string, auth = admin) => (await api().get(`/products/${id}`).set("Authorization", auth).expect(200)).body;
  const newPurchase = async (supplierId: string, body: Record<string, unknown> = {}, auth = backoffice) =>
    (await api().post("/purchase-orders").set("Authorization", auth).send({ supplierId, ...body }).expect(201)).body;
  const addLine = (id: string, body: Record<string, unknown>, auth = backoffice) => api().post(`/purchase-orders/${id}/lines`).set("Authorization", auth).send(body);
  const step = (id: string, action: string, body: Record<string, unknown> = {}, auth = backoffice) => api().post(`/purchase-orders/${id}/${action}`).set("Authorization", auth).send(body);
  const get = async (id: string, auth = backoffice) => (await api().get(`/purchase-orders/${id}`).set("Authorization", auth).expect(200)).body;
  const list = async (query: Record<string, unknown>, auth = backoffice) => (await api().get("/purchase-orders").query(query).set("Authorization", auth).expect(200)).body;
  /** Compra enviada com as linhas dadas (`[produto, quantidade]`). */
  const sent = async (supplierId: string, lines: Array<[string, number]>) => {
    const p = await newPurchase(supplierId);
    for (const [productId, quantity] of lines) await addLine(p.id, { productId, quantity }).expect(201);
    return (await step(p.id, "send").expect(200)).body;
  };
  const lineOf = (purchase: { lines: Array<{ id: string; productId: string }> }, productId: string) => purchase.lines.find((l) => l.productId === productId)!.id;
  const notes = async (entityType: "ORDER" | "PURCHASE_ORDER", id: string) =>
    (await prisma().timelineEvent.findMany({ where: { entityType, entityId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((e) => e.description);

  // Encomendas de cliente (6a/6b).
  const order = async (lines: Array<[string, number]>, extra: Record<string, unknown> = {}) => {
    const o = (await api().post("/orders").set("Authorization", comercial).send({ companyId, ...extra }).expect(201)).body as { id: string; code: string };
    for (const [productId, quantity] of lines) await api().post(`/orders/${o.id}/lines`).set("Authorization", comercial).send({ productId, quantity }).expect(201);
    return o;
  };
  const confirm = async (id: string) => (await api().post(`/orders/${id}/confirm`).set("Authorization", comercial).expect(200)).body;
  const waitingOf = async (id: string) => (await api().get(`/orders/${id}`).set("Authorization", comercial).expect(200)).body.lines.map((l: { waitingQuantity: number }) => l.waitingQuantity);
  const tasksOf = async (orderId: string) => {
    const body = (await api().get("/tasks").query({ salesOrderId: orderId }).set("Authorization", admin).expect(200)).body;
    return (body.items ?? body) as Array<{ id: string; title: string; typeId: string; assigneeId: string; companyId: string | null; dueDate: string; salesOrder: { id: string; number: number } }>;
  };

  it("rascunho: linhas com o custo e a referência do fornecedor, totais, produto repetido, só fornecedores, só em rascunho", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const drum = await newProduct({ sku: "DR-2400", name: "Tambor" });
    const off = await newProduct({ sku: "OLD-1", name: "Antigo", active: false });
    await link(toner.id, s1, { costPrice: 31.5, supplierSku: "D-998" });

    await api().post("/purchase-orders").set("Authorization", backoffice).send({ supplierId: companyId }).expect(400);
    await api().post("/purchase-orders").set("Authorization", backoffice).send({ supplierId: s1, expectedAt: "01/12/2026" }).expect(400);
    const p = await newPurchase(s1, { supplierReference: "PROP-77", expectedAt: "2026-12-01" });
    expect(p).toMatchObject({ code: "CF-0001", status: "DRAFT", supplierReference: "PROP-77", expectedAt: "2026-12-01", total: 0, supplier: { name: "Distribuidora Norte" } });

    let view = (await addLine(p.id, { productId: toner.id, quantity: 10 }).expect(201)).body;
    expect(view.lines[0]).toMatchObject({ sku: "TN-2420", description: "Toner preto", supplierSku: "D-998", quantity: 10, unitCost: 31.5, lineTotal: 315, receivedQuantity: 0, remainingQuantity: 10 });
    view = (await addLine(p.id, { productId: drum.id, quantity: 2, unitCost: 12.3456 }).expect(201)).body;
    expect(view.lines[1]).toMatchObject({ supplierSku: null, unitCost: 12.3456, lineTotal: 24.69 });
    expect(view.total).toBe(339.69);
    expect((await addLine(p.id, { productId: toner.id, quantity: 1 }).expect(409)).body.message).toMatch(/já está nesta compra/);
    await addLine(p.id, { productId: off.id, quantity: 1 }).expect(400);
    await addLine(p.id, { productId: toner.id, quantity: 0 }).expect(400);
    await addLine(p.id, { productId: toner.id, quantity: 1, unitCost: 1.23456 }).expect(400);

    const drumLine = lineOf(view, drum.id);
    view = (await api().patch(`/purchase-orders/${p.id}/lines/${drumLine}`).set("Authorization", backoffice).send({ quantity: 3 }).expect(200)).body;
    expect(view.lines[1].lineTotal).toBe(37.04);
    expect(view.total).toBe(352.04);
    view = (await api().delete(`/purchase-orders/${p.id}/lines/${drumLine}`).set("Authorization", backoffice).expect(200)).body;
    expect(view.total).toBe(315);

    await api().patch(`/purchase-orders/${p.id}`).set("Authorization", backoffice).send({ supplierId: companyId }).expect(400);
    await api().patch(`/purchase-orders/${p.id}`).set("Authorization", backoffice).send({ supplierId: s2 }).expect(200);
    await api().patch(`/purchase-orders/${p.id}`).set("Authorization", backoffice).send({ supplierId: s1, expectedAt: null }).expect(200);

    const empty = await newPurchase(s2);
    expect((await step(empty.id, "send").expect(400)).body.message).toMatch(/pelo menos uma linha/);
    await api().delete(`/purchase-orders/${empty.id}`).set("Authorization", backoffice).expect(204);

    view = (await step(p.id, "send").expect(200)).body;
    expect(view).toMatchObject({ status: "SENT", partiallyReceived: false });
    expect(view.sentAt).toBeTruthy();
    await addLine(p.id, { productId: drum.id, quantity: 1 }).expect(409);
    await api().patch(`/purchase-orders/${p.id}/lines/${view.lines[0].id}`).set("Authorization", backoffice).send({ quantity: 1 }).expect(409);
    await api().patch(`/purchase-orders/${p.id}`).set("Authorization", backoffice).send({ supplierId: s2 }).expect(409);
    await api().patch(`/purchase-orders/${p.id}`).set("Authorization", backoffice).send({ notes: "Pedir fatura com NIF" }).expect(200);
    await api().delete(`/purchase-orders/${p.id}`).set("Authorization", backoffice).expect(409);
    await step(p.id, "send").expect(409);

    expect(await notes("PURCHASE_ORDER", p.id)).toEqual([
      "Compra CF-0001 criada",
      "Linha acrescentada: 10 × Toner preto (TN-2420)",
      "Linha acrescentada: 2 × Tambor (DR-2400)",
      "Linha alterada: 2 × Tambor (DR-2400) → 3 × Tambor (DR-2400)",
      "Linha retirada: 3 × Tambor (DR-2400)",
      "Fornecedor: Papelaria Sul",
      "Fornecedor: Distribuidora Norte",
      "Sem data prevista de entrega",
      "Compra enviada ao fornecedor",
    ]);
    const audit = await prisma().auditEvent.findMany({ where: { targetType: "purchase" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["purchase.deleted", "purchase.sent"]);
  });

  it("receção: em parte e completa, entradas de stock com origem na compra, a mais recusado, produto sem stock", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const service = await newProduct({ sku: "INST", name: "Instalação", tracksStock: false });
    const p = await sent(s1, [[toner.id, 10], [service.id, 1]]);
    const tonerLine = lineOf(p, toner.id);
    const serviceLine = lineOf(p, service.id);
    expect((await product(toner.id)).onOrder).toBe(10);

    let view = (await step(p.id, "receive", { lines: [{ lineId: tonerLine, quantity: 4 }], note: "Guia GR-12" }).expect(200)).body;
    expect(view).toMatchObject({ status: "SENT", partiallyReceived: true });
    expect(view.lines.map((l: { receivedQuantity: number; remainingQuantity: number }) => [l.receivedQuantity, l.remainingQuantity])).toEqual([[4, 6], [0, 1]]);
    expect(view.receipts).toMatchObject([{ quantity: 4, note: "Guia GR-12", product: { sku: "TN-2420" } }]);
    const movement = await prisma().stockMovement.findFirstOrThrow({ where: { productId: toner.id } });
    expect(movement).toMatchObject({ type: "PURCHASE_IN", sourceType: "PURCHASE_ORDER", sourceId: p.id, reason: "CF-0001: receção", note: "Guia GR-12" });
    expect(Number(movement.quantity)).toBe(4);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 4, onOrder: 6 });
    expect((await list({ status: "SENT" })).items[0]).toMatchObject({ code: "CF-0001", partiallyReceived: true });

    expect((await step(p.id, "receive", { lines: [{ lineId: tonerLine, quantity: 7 }] }).expect(400)).body.message).toMatch(/só falta 6 × Toner preto/);
    await step(p.id, "receive", { lines: [{ lineId: tonerLine, quantity: 1 }, { lineId: tonerLine, quantity: 1 }] }).expect(400);
    await step(p.id, "receive", { lines: [{ lineId: "nao-existe", quantity: 1 }] }).expect(400);
    await step(p.id, "receive", { lines: [{ lineId: tonerLine, quantity: 0 }] }).expect(400);
    await step(p.id, "receive", { lines: [] }).expect(400);

    view = (await step(p.id, "receive", { lines: [{ lineId: tonerLine, quantity: 6 }, { lineId: serviceLine, quantity: 1 }] }).expect(200)).body;
    expect(view).toMatchObject({ status: "RECEIVED", partiallyReceived: false });
    expect(view.receivedAt).toBeTruthy();
    // O serviço não controla stock: fica recebido, sem movimento.
    expect(await prisma().stockMovement.count({ where: { productId: service.id } })).toBe(0);
    expect(await prisma().stockMovement.count({ where: { sourceId: p.id } })).toBe(2);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 10, onOrder: 0 });

    await step(p.id, "receive", { lines: [{ lineId: tonerLine, quantity: 1 }] }).expect(409);
    await step(p.id, "close", { reason: "x" }).expect(409);
    await step(p.id, "cancel", { reason: "x" }).expect(409);
    await api().patch(`/purchase-orders/${p.id}`).set("Authorization", backoffice).send({ notes: "x" }).expect(409);

    expect((await notes("PURCHASE_ORDER", p.id)).slice(-3)).toEqual([
      "Receção: 4 × Toner preto (TN-2420) — Guia GR-12",
      "Receção: 6 × Toner preto (TN-2420); 1 × Instalação (INST)",
      "Compra recebida por completo",
    ]);
    const audit = await prisma().auditEvent.findMany({ where: { targetId: p.id, action: "purchase.received" }, orderBy: { createdAt: "asc" } });
    expect(audit).toHaveLength(2);
    expect(audit[0].metadata).toMatchObject({ note: "Guia GR-12" });
  });

  it("fechar com falta e cancelar: o que já não vem sai do «em compra»; os rascunhos contam", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const a = await sent(s1, [[toner.id, 5]]);
    expect((await step(a.id, "close", { reason: "Sem stock" }).expect(409)).body.message).toMatch(/cancela a compra/);
    let view = (await step(a.id, "cancel", { reason: "Engano" }).expect(200)).body;
    expect(view).toMatchObject({ status: "CANCELLED", closeReason: "Engano" });
    expect((await product(toner.id)).onOrder).toBe(0);

    const b = await sent(s1, [[toner.id, 5]]);
    await step(b.id, "receive", { lines: [{ lineId: lineOf(b, toner.id), quantity: 2 }] }).expect(200);
    expect((await step(b.id, "cancel", { reason: "x" }).expect(409)).body.message).toMatch(/fecha-a com falta/);
    await step(b.id, "close", {}).expect(400);
    await step(b.id, "close", { reason: "   " }).expect(400);
    view = (await step(b.id, "close", { reason: "O fornecedor não tem mais" }).expect(200)).body;
    expect(view).toMatchObject({ status: "CLOSED", closeReason: "O fornecedor não tem mais" });
    expect(view.closedAt).toBeTruthy();
    expect((await notes("PURCHASE_ORDER", b.id)).slice(-1)).toEqual(["Compra fechada com falta: O fornecedor não tem mais (não vem: 3 × Toner preto (TN-2420))"]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 2, onOrder: 0 });

    const draft = await newPurchase(s1);
    await addLine(draft.id, { productId: toner.id, quantity: 4 }).expect(201);
    expect((await product(toner.id)).onOrder).toBe(4);
    await step(draft.id, "cancel", { reason: "Já não é preciso" }).expect(200);
    expect((await product(toner.id)).onOrder).toBe(0);
    expect((await list({ status: "CANCELLED" })).items.map((p: { code: string }) => p.code)).toEqual(["CF-0003", "CF-0001"]);
    const audit = await prisma().auditEvent.findMany({ where: { targetType: "purchase", action: { in: ["purchase.cancelled", "purchase.closed"] } }, orderBy: { createdAt: "asc" } });
    expect(audit.map((x) => [x.action, x.metadata])).toEqual([
      ["purchase.cancelled", { reason: "Engano" }],
      ["purchase.closed", { reason: "O fornecedor não tem mais" }],
      ["purchase.cancelled", { reason: "Já não é preciso" }],
    ]);
  });

  it("a receção serve as encomendas à espera pela ordem da confirmação; a que fica completa pede a tarefa «Preparar encomenda», uma vez", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const paper = await newProduct({ sku: "A4", name: "Papel A4" });
    const a = await order([[toner.id, 3]]);
    await confirm(a.id);
    const b = await order([[toner.id, 4]], { assigneeId: backofficeId });
    await confirm(b.id);
    const p = await sent(s1, [[toner.id, 20]]);
    const line = lineOf(p, toner.id);

    await step(p.id, "receive", { lines: [{ lineId: line, quantity: 5 }] }).expect(200);
    expect(await waitingOf(a.id)).toEqual([0]);
    expect(await waitingOf(b.id)).toEqual([2]);
    // Na linha à espera, o que está em compra do produto (20 − 5 recebidos).
    expect((await api().get(`/orders/${b.id}`).set("Authorization", comercial).expect(200)).body.lines[0].product).toMatchObject({ onOrder: 15 });
    const [taskA, ...moreA] = await tasksOf(a.id);
    expect(moreA).toEqual([]);
    expect(taskA).toMatchObject({ title: `Preparar encomenda ${a.code}`, typeId: "PREPARAR_ENCOMENDA", assigneeId: comercialId, companyId, salesOrder: { id: a.id, number: 1 } });
    expect(new Date(taskA.dueDate).toDateString()).toBe(new Date().toDateString());
    expect(await tasksOf(b.id)).toEqual([]);
    expect((await notes("ORDER", a.id)).slice(-3)).toEqual([
      "Stock reservado: 3 × Toner preto (TN-2420)",
      "Todo o stock da encomenda está reservado",
      `Tarefa criada: «Preparar encomenda ${a.code}» para Carla Comercial`,
    ]);

    // Completa a segunda: a tarefa vai para o responsável da encomenda.
    await step(p.id, "receive", { lines: [{ lineId: line, quantity: 5 }] }).expect(200);
    expect(await tasksOf(b.id)).toMatchObject([{ title: `Preparar encomenda ${b.code}`, assigneeId: backofficeId }]);
    // Pedir outra vez a tarefa de uma encomenda que já a tem: não cria segunda.
    const preparation = app.get(OrderPreparationService);
    await preparation.afterAllocation([b.id], backofficeId);
    expect(await tasksOf(b.id)).toHaveLength(1);
    // Mais entradas, mesmo depois de concluída a tarefa: não há segunda.
    await api().patch(`/tasks/${taskA.id}`).set("Authorization", comercial).send({ status: "DONE" }).expect(200);
    expect((await notes("ORDER", a.id)).slice(-1)).toEqual([`Tarefa concluída: "Preparar encomenda ${a.code}".`]);
    await move(toner.id, "PURCHASE_IN", 5);
    expect(await tasksOf(a.id)).toHaveLength(1);
    expect(await tasksOf(b.id)).toHaveLength(1);

    // Um movimento manual também completa: a terceira estava à espera.
    const c = await order([[toner.id, 10]]);
    await confirm(c.id);
    expect(await waitingOf(c.id)).toEqual([2]);
    expect((await api().get("/orders").query({ ready: "true" }).set("Authorization", comercial).expect(200)).body.items.map((o: { id: string }) => o.id).sort()).toEqual([a.id, b.id].sort());
    await move(toner.id, "PURCHASE_IN", 2);
    expect(await tasksOf(c.id)).toHaveLength(1);
    expect((await api().get("/orders").query({ ready: "true" }).set("Authorization", comercial).expect(200)).body.items).toHaveLength(3);

    // Completa logo ao confirmar: sem tarefa (quem confirma já sabe).
    await move(paper.id, "INITIAL", 10);
    const d = await order([[paper.id, 2]]);
    await confirm(d.id);
    expect(await tasksOf(d.id)).toEqual([]);
    // Pedidos em simultâneo para a mesma encomenda completa (como duas entradas de produtos diferentes que acabam ao
    // mesmo tempo): a reclamação de `preparationTaskAt` deixa uma só tarefa.
    await Promise.all(Array.from({ length: 10 }, () => preparation.afterAllocation([d.id], backofficeId)));
    expect(await tasksOf(d.id)).toHaveLength(1);

    // Com o tipo «Preparar encomenda» desativado, não há tarefas.
    await api().patch("/work-item-types/PREPARAR_ENCOMENDA").set("Authorization", admin).send({ active: false }).expect(200);
    const e = await order([[paper.id, 10]]);
    await confirm(e.id);
    await move(paper.id, "PURCHASE_IN", 2);
    expect(await waitingOf(e.id)).toEqual([0]);
    expect(await tasksOf(e.id)).toEqual([]);
    expect((await prisma().salesOrder.findUniqueOrThrow({ where: { id: e.id } })).preparationTaskAt).toBeNull();
  });

  it("sugestões: a comprar = à espera + reservado acima do stock − em compra; «Criar compras» junta ao rascunho do fornecedor e não repete", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const drum = await newProduct({ sku: "DR-2400", name: "Tambor" });
    const paper = await newProduct({ sku: "A4", name: "Papel A4" });
    const kit = await newProduct({ sku: "KIT", name: "Kit de limpeza" });
    const tape = await newProduct({ sku: "FITA", name: "Fita" });
    const cable = await newProduct({ sku: "CABO", name: "Cabo USB" });
    await link(toner.id, s1, { costPrice: 30, preferred: true });
    await link(toner.id, s2, { costPrice: 29 });
    // Tambor: um só fornecedor, não marcado como preferido; papel: dois, nenhum preferido.
    await link(drum.id, s2, { costPrice: 10, supplierSku: "SUL-DR", preferred: false });
    await link(paper.id, s1, { preferred: false });
    await link(paper.id, s2, { preferred: false });
    await link(tape.id, s1, { costPrice: 2 });
    await link(cable.id, s1, { costPrice: 3 });

    await move(toner.id, "INITIAL", 1);
    await move(tape.id, "INITIAL", 3);
    const o1 = await order([[toner.id, 5], [drum.id, 2], [paper.id, 3], [kit.id, 1], [tape.id, 3]]);
    await confirm(o1.id);
    const o2 = await order([[toner.id, 2], [cable.id, 4]]);
    await confirm(o2.id);
    // Fita: reservada 3, stock 1 (saída manual) → 2 acima do stock.
    await move(tape.id, "SALE_OUT", 2);
    // Toner já tem 1 num rascunho de S1; cabo está todo numa compra enviada.
    const draft = await newPurchase(s1);
    await addLine(draft.id, { productId: toner.id, quantity: 1 }).expect(201);
    await sent(s1, [[cable.id, 4]]);

    const { items } = (await api().get("/purchase-orders/suggestions").set("Authorization", backoffice).expect(200)).body;
    const bySku = Object.fromEntries(items.map((i: { product: { sku: string } }) => [i.product.sku, i]));
    expect(Object.keys(bySku).sort()).toEqual(["A4", "DR-2400", "FITA", "KIT", "TN-2420"]);
    expect(bySku["TN-2420"]).toMatchObject({ waiting: 6, overReserved: 0, onOrder: 1, need: 5, supplier: { id: s1 }, supplierCount: 2, unitCost: 30, orders: [{ id: o1.id, code: o1.code }, { id: o2.id, code: o2.code }] });
    expect(bySku["DR-2400"]).toMatchObject({ need: 2, supplier: { id: s2, name: "Papelaria Sul" }, unitCost: 10 });
    expect(bySku["A4"]).toMatchObject({ need: 3, supplier: null, supplierCount: 2 });
    expect(bySku["KIT"]).toMatchObject({ need: 1, supplier: null, supplierCount: 0 });
    expect(bySku["FITA"]).toMatchObject({ waiting: 0, overReserved: 2, need: 2, supplier: { id: s1 } });
    const asComercial = (await api().get("/purchase-orders/suggestions").set("Authorization", comercial).expect(200)).body.items;
    expect(asComercial.every((i: Record<string, unknown>) => !("unitCost" in i))).toBe(true);

    const all = [toner.id, drum.id, paper.id, kit.id, tape.id, cable.id];
    await api().post("/purchase-orders/generate").set("Authorization", comercial).send({ productIds: all }).expect(403);
    const res = (await api().post("/purchase-orders/generate").set("Authorization", backoffice).send({ productIds: all }).expect(200)).body;
    expect(res.purchases.map((p: { id: string; supplier: { id: string }; created: boolean }) => [p.supplier.id, p.created]).sort()).toEqual([[s1, false], [s2, true]].sort());
    expect(res.purchases.find((p: { supplier: { id: string } }) => p.supplier.id === s1).id).toBe(draft.id);
    expect(Object.fromEntries(res.skipped.map((s: { product: { sku: string }; reason: string }) => [s.product.sku, s.reason]))).toEqual({
      A4: "Tem vários fornecedores e nenhum preferido",
      KIT: "Não tem fornecedor",
      CABO: "Já está coberto (nada a comprar)",
    });
    const fromS1 = await get(draft.id);
    expect(fromS1.lines.map((l: { sku: string; quantity: number; unitCost: number }) => [l.sku, l.quantity, l.unitCost])).toEqual([["TN-2420", 6, 30], ["FITA", 2, 2]]);
    expect(fromS1.total).toBe(184);
    const fromS2 = await get(res.purchases.find((p: { supplier: { id: string } }) => p.supplier.id === s2).id);
    expect(fromS2.lines.map((l: { sku: string; quantity: number; unitCost: number; supplierSku: string }) => [l.sku, l.quantity, l.unitCost, l.supplierSku])).toEqual([["DR-2400", 2, 10, "SUL-DR"]]);
    expect(await notes("PURCHASE_ORDER", fromS2.id)).toEqual([`Compra ${fromS2.code} criada a partir das encomendas à espera`, `Para as encomendas à espera (${o1.code}): 2 × Tambor (DR-2400)`]);
    expect((await notes("PURCHASE_ORDER", draft.id)).slice(-1)).toEqual([`Para as encomendas à espera (${o1.code}, ${o2.code}): 2 × Fita (FITA); 5 × Toner preto (TN-2420)`]);
    const audit = await prisma().auditEvent.findFirstOrThrow({ where: { action: "purchase.generated" } });
    expect(audit.metadata).toMatchObject({ productIds: all });

    // Já está tudo coberto: não repete.
    const again = (await api().post("/purchase-orders/generate").set("Authorization", backoffice).send({ productIds: [toner.id, drum.id, tape.id] }).expect(200)).body;
    expect(again.purchases).toEqual([]);
    expect(again.skipped).toHaveLength(3);
    expect((await api().get("/purchase-orders/suggestions").set("Authorization", backoffice).expect(200)).body.items.map((i: { product: { sku: string } }) => i.product.sku).sort()).toEqual(["A4", "KIT"]);

    await api().post("/purchase-orders/generate").set("Authorization", backoffice).send({ productIds: [] }).expect(400);
    await api().post("/purchase-orders/generate").set("Authorization", backoffice).send({ productIds: ["nao-existe"] }).expect(400);
    // Sem encomendas não há sugestões (as compras continuam).
    await api().patch("/modules/encomendas").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().get("/purchase-orders/suggestions").set("Authorization", backoffice).expect(400);
    await api().post("/purchase-orders/generate").set("Authorization", backoffice).send({ productIds: [toner.id] }).expect(400);
    await api().get("/purchase-orders").set("Authorization", backoffice).expect(200);
  });

  it("custos só com a área do catálogo; quem escreve; módulo e dependências; o que não se apaga; pesquisa e filtros", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const drum = await newProduct({ sku: "DR-2400", name: "Tambor" });
    await link(toner.id, s1, { costPrice: 31.5 });
    const p = await sent(s1, [[toner.id, 2]]);

    const asComercial = await get(p.id, comercial);
    expect(asComercial).not.toHaveProperty("total");
    expect(asComercial.lines[0]).not.toHaveProperty("unitCost");
    expect(asComercial.lines[0]).not.toHaveProperty("lineTotal");
    expect((await list({}, comercial)).items[0]).not.toHaveProperty("total");
    expect((await get(p.id, backoffice)).total).toBe(63);
    await api().get("/purchase-orders").set("Authorization", tecnico).expect(200);
    await api().post("/purchase-orders").set("Authorization", comercial).send({ supplierId: s1 }).expect(403);
    await api().post("/purchase-orders").set("Authorization", tecnico).send({ supplierId: s1 }).expect(403);

    // A Comercial passa a poder comprar, mas continua sem ver custos: leva o custo do catálogo e não o altera.
    await api().patch("/permissions/purchases").set("Authorization", admin).send({ roles: ["ADMINISTRADOR", "BACKOFFICE", "COMERCIAL"] }).expect(200);
    const mine = await newPurchase(s1, {}, comercial);
    const view = (await addLine(mine.id, { productId: toner.id, quantity: 3 }, comercial).expect(201)).body;
    expect(view.lines[0]).not.toHaveProperty("unitCost");
    expect((await get(mine.id, backoffice)).lines[0].unitCost).toBe(31.5);
    expect((await addLine(mine.id, { productId: drum.id, quantity: 1, unitCost: 5 }, comercial).expect(403)).body.message).toMatch(/preços de custo/);
    await api().patch(`/purchase-orders/${mine.id}/lines/${view.lines[0].id}`).set("Authorization", comercial).send({ unitCost: 1 }).expect(403);
    await api().patch(`/purchase-orders/${mine.id}/lines/${view.lines[0].id}`).set("Authorization", comercial).send({ quantity: 4 }).expect(200);

    // Pesquisa e filtros.
    await api().patch(`/purchase-orders/${mine.id}`).set("Authorization", backoffice).send({ supplierReference: "ENC-ABC-9" }).expect(200);
    const other = await newPurchase(s2);
    await addLine(other.id, { productId: drum.id, quantity: 1 }).expect(201);
    const codes = async (query: Record<string, unknown>) => (await list(query)).items.map((x: { code: string }) => x.code);
    expect(await codes({})).toEqual(["CF-0003", "CF-0002", "CF-0001"]);
    expect(await codes({ search: "cf-0002" })).toEqual(["CF-0002"]);
    expect(await codes({ search: "1" })).toEqual(["CF-0001"]);
    expect(await codes({ search: "enc-abc" })).toEqual(["CF-0002"]);
    expect(await codes({ search: "papelaria" })).toEqual(["CF-0003"]);
    expect(await codes({ supplierId: s1 })).toEqual(["CF-0002", "CF-0001"]);
    expect(await codes({ productId: drum.id })).toEqual(["CF-0003"]);
    expect(await codes({ status: "SENT" })).toEqual(["CF-0001"]);
    const page1 = await list({ limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect((await list({ limit: 2, cursor: page1.nextCursor })).items.map((x: { code: string }) => x.code)).toEqual(["CF-0001"]);
    await api().get("/purchase-orders").query({ status: "PERDIDA" }).set("Authorization", backoffice).expect(400);

    // O que está em compras não se apaga.
    expect((await api().delete(`/products/${toner.id}`).set("Authorization", admin).expect(409)).body.message).toMatch(/compras/);
    expect((await api().delete(`/companies/${s2}`).set("Authorization", admin).expect(409)).body.message).toMatch(/compras/);

    // Módulo: o stock não se desliga com as compras ligadas; sem compras, a API não existe e o produto não diz «em compra».
    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: false }).expect(400);
    await api().patch("/modules/compras").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().get("/purchase-orders").set("Authorization", backoffice).expect(404);
    expect(await product(toner.id)).not.toHaveProperty("onOrder");
    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().patch("/modules/compras").set("Authorization", admin).send({ enabled: true }).expect(400);
  });

  it("em simultâneo: duas receções não recebem a mais; duas gerações não compram duas vezes", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    await link(toner.id, s1, { costPrice: 30 });
    const p = await sent(s1, [[toner.id, 5]]);
    const line = lineOf(p, toner.id);
    const results = await Promise.all([1, 2].map(() => step(p.id, "receive", { lines: [{ lineId: line, quantity: 5 }] })));
    // A primeira recebe tudo e a compra fica recebida: a segunda já não encontra uma compra enviada.
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await get(p.id)).lines[0].receivedQuantity).toBe(5);
    expect((await product(toner.id)).stockOnHand).toBe(5);

    const drum = await newProduct({ sku: "DR-2400", name: "Tambor" });
    await link(drum.id, s1, { costPrice: 10 });
    const o = await order([[drum.id, 4]]);
    await confirm(o.id);
    const gens = await Promise.all([1, 2].map(() => api().post("/purchase-orders/generate").set("Authorization", backoffice).send({ productIds: [drum.id] })));
    expect(gens.map((g) => g.status)).toEqual([200, 200]);
    const lines = await prisma().purchaseOrderLine.findMany({ where: { productId: drum.id } });
    expect(lines.map((l) => Number(l.quantity))).toEqual([4]);
    expect(await prisma().purchaseOrder.count({ where: { status: "DRAFT" } })).toBe(1);
  });
});
