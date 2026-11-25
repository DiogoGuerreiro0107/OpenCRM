import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";

// Fase 6d (docs/plano-fase-6-encomendas.md): transportadoras, expedições (envio total ou parcial), «dar por enviada sem
// o resto» e os eventos de webhook das encomendas.
describe("Expedições das encomendas (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let comercial: string;
  let tecnico: string;
  let companyId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    comercial = await bearerFor(app, await createUser(prisma(), "COMERCIAL", "Carla Comercial"));
    tecnico = await bearerFor(app, await createUser(prisma(), "TECNICO"));
    companyId = (await api().post("/companies").set("Authorization", admin).send({ name: "Gráfica São João" }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const newProduct = async (body: Record<string, unknown> = {}) =>
    (await api().post("/products").set("Authorization", admin).send({ sku: `p-${Math.random().toString(36).slice(2, 8)}`, name: "Toner preto", salePrice: 45.9, vatRate: 23, tracksStock: true, ...body }).expect(201)).body as { id: string; sku: string };
  const move = (productId: string, type: string, quantity: number) => api().post("/stock/movements").set("Authorization", admin).send({ productId, type, quantity, reason: "teste" }).expect(201);
  const product = async (id: string) => (await api().get(`/products/${id}`).set("Authorization", admin).expect(200)).body as { stockOnHand: number; reserved: number; available: number };
  const confirmed = async (lines: Array<[string, number] | "avulsa">) => {
    const o = (await api().post("/orders").set("Authorization", comercial).send({ companyId, customerReference: "PO-77" }).expect(201)).body as { id: string; code: string };
    for (const line of lines) {
      const body = line === "avulsa" ? { description: "Portes", quantity: 1, unitPrice: 5, vatRate: 23 } : { productId: line[0], quantity: line[1] };
      await api().post(`/orders/${o.id}/lines`).set("Authorization", comercial).send(body).expect(201);
    }
    return (await api().post(`/orders/${o.id}/confirm`).set("Authorization", comercial).expect(200)).body as OrderView;
  };
  const step = (id: string, action: string, body: Record<string, unknown> = {}, auth = comercial) => api().post(`/orders/${id}/${action}`).set("Authorization", auth).send(body);
  const get = async (id: string) => (await api().get(`/orders/${id}`).set("Authorization", comercial).expect(200)).body as OrderView;
  const linesOf = async (id: string) => (await get(id)).lines.map((l) => [l.shippedQuantity, l.unshippedQuantity, l.reservedQuantity, l.waitingQuantity]);
  const notes = async (id: string) =>
    (await prisma().timelineEvent.findMany({ where: { entityType: "ORDER", entityId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((e) => e.description);
  const carrier = async (body: Record<string, unknown> = {}, auth = comercial) =>
    (await api().post("/carriers").set("Authorization", auth).send({ name: "CTT Expresso", trackingUrlTemplate: "https://seguir.exemplo.pt/?n={codigo}", ...body }).expect(201)).body as { id: string };
  const list = async (query: Record<string, unknown>) => (await api().get("/orders").query(query).set("Authorization", comercial).expect(200)).body.items as Array<{ id: string; partiallyShipped: boolean; status: string }>;
  /** O enviado de cada linha é sempre a soma das expedições; o reservado do produto, a soma das linhas. */
  const assertConsistent = async (orderId: string) => {
    const lines = await prisma().salesOrderLine.findMany({ where: { orderId }, include: { shipmentLines: true } });
    for (const l of lines) {
      expect(Number(l.shippedQuantity)).toBeCloseTo(l.shipmentLines.reduce((s, x) => s + Number(x.quantity), 0));
      expect(Number(l.unshippedQuantity)).toBeCloseTo(Number(l.quantity) - Number(l.shippedQuantity));
    }
    for (const productId of new Set(lines.map((l) => l.productId).filter((p): p is string => !!p))) {
      const sum = await prisma().salesOrderLine.aggregate({ where: { productId }, _sum: { reservedQuantity: true } });
      expect(Number((await prisma().product.findUniqueOrThrow({ where: { id: productId } })).reserved)).toBeCloseTo(Number(sum._sum.reservedQuantity ?? 0));
    }
  };

  type OrderView = {
    id: string;
    code: string;
    status: string;
    partiallyShipped: boolean;
    lines: Array<{ id: string; productId: string | null; shippedQuantity: number; unshippedQuantity: number; reservedQuantity: number; waitingQuantity: number }>;
    shipments: Array<{ id: string; carrier: { id: string; name: string } | null; trackingCode: string | null; trackingUrl: string | null; packages: number | null; weightKg: number | null; cost: number | null; notes: string | null; lines: Array<{ orderLineId: string; quantity: number }> }>;
  };

  it("transportadoras: criar, nome repetido, link com {codigo}, permissões, desativar e apagar", async () => {
    await api().post("/carriers").set("Authorization", tecnico).send({ name: "DPD" }).expect(403);
    const ctt = await carrier();
    await api().post("/carriers").set("Authorization", comercial).send({ name: " ctt expresso " }).expect(409);
    await api().post("/carriers").set("Authorization", comercial).send({ name: "GLS", trackingUrlTemplate: "https://gls.exemplo.pt/seguir" }).expect(400);
    await api().post("/carriers").set("Authorization", comercial).send({ name: "GLS", trackingUrlTemplate: "ftp://gls.exemplo.pt/{codigo}" }).expect(400);
    const gls = (await api().post("/carriers").set("Authorization", comercial).send({ name: "GLS", trackingUrlTemplate: "  ", sortOrder: 1 }).expect(201)).body;
    expect(gls.trackingUrlTemplate).toBeNull();
    await api().patch(`/carriers/${gls.id}`).set("Authorization", comercial).send({ trackingUrlTemplate: "https://gls.exemplo.pt/seguir" }).expect(400);
    await api().patch(`/carriers/${gls.id}`).set("Authorization", comercial).send({ name: "CTT Expresso" }).expect(409);
    await api().patch(`/carriers/${gls.id}`).set("Authorization", comercial).send({ active: false }).expect(200);

    const all = (await api().get("/carriers").set("Authorization", tecnico).expect(200)).body;
    expect(all.map((c: { name: string; active: boolean; shipmentCount: number }) => [c.name, c.active, c.shipmentCount])).toEqual([
      ["CTT Expresso", true, 0],
      ["GLS", false, 0],
    ]);

    // Inativa não se escolhe; com expedições não se apaga.
    const p = await newProduct({ tracksStock: false });
    const o = await confirmed([[p.id, 1]]);
    await step(o.id, "ship", { carrierId: gls.id }).expect(400);
    await step(o.id, "ship", { carrierId: "nao-existe" }).expect(400);
    await step(o.id, "ship", { carrierId: ctt.id }).expect(200);
    await api().delete(`/carriers/${ctt.id}`).set("Authorization", comercial).expect(409);
    await api().delete(`/carriers/${gls.id}`).set("Authorization", comercial).expect(204);
    expect((await api().get("/carriers").set("Authorization", comercial).expect(200)).body[0].shipmentCount).toBe(1);

    // Com o módulo «Encomendas» desligado, as transportadoras também.
    await api().patch("/modules/compras").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().patch("/modules/encomendas").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().get("/carriers").set("Authorization", comercial).expect(404);
  });

  it("envio total: uma expedição com a transportadora, o código e o link; a encomenda fica enviada", async () => {
    const ctt = await carrier();
    const toner = await newProduct({ sku: "TN-2420" });
    await move(toner.id, "INITIAL", 5);
    const o = await confirmed([[toner.id, 2], "avulsa"]);

    const shipped = (await step(o.id, "ship", { carrierId: ctt.id, trackingCode: " AB 12/3 ", packages: 2, weightKg: 3.5, cost: 7.9, notes: "Frágil" }).expect(200)).body as OrderView;
    expect(shipped.status).toBe("SHIPPED");
    expect(shipped.partiallyShipped).toBe(false);
    expect(shipped.shipments).toHaveLength(1);
    expect(shipped.shipments[0]).toMatchObject({
      carrier: { id: ctt.id, name: "CTT Expresso" },
      trackingCode: "AB 12/3",
      trackingUrl: "https://seguir.exemplo.pt/?n=AB%2012%2F3",
      packages: 2,
      weightKg: 3.5,
      cost: 7.9,
      notes: "Frágil",
    });
    expect(shipped.shipments[0].lines.map((l) => l.quantity)).toEqual([2, 1]);
    expect(await linesOf(o.id)).toEqual([
      [2, 0, 0, 0],
      [1, 0, 0, 0],
    ]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 3, reserved: 0 });
    expect((await notes(o.id)).slice(-3)).toEqual(["Encomenda enviada", "Expedição: CTT Expresso · código AB 12/3 · 2 volumes · 3,5 kg · 7,90 €", "Saída de stock: 2 × Toner preto (TN-2420)"]);
    const movement = await prisma().stockMovement.findFirstOrThrow({ where: { productId: toner.id, type: "SALE_OUT" } });
    expect(movement).toMatchObject({ reason: `${o.code}: encomenda enviada`, sourceType: "SALES_ORDER", sourceId: o.id });
    await step(o.id, "ship").expect(409);
    await assertConsistent(o.id);
  });

  it("envio parcial: sai o reservado, o resto continua a aguardar e é servido pelas entradas; depois envia-se o resto", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const drum = await newProduct({ sku: "DR-2400", name: "Tambor" });
    await move(toner.id, "INITIAL", 3);
    await move(drum.id, "INITIAL", 2);
    const o = await confirmed([[toner.id, 5], [drum.id, 2], "avulsa"]);
    expect(await linesOf(o.id)).toEqual([
      [0, 5, 3, 2],
      [0, 2, 2, 0],
      [0, 1, 0, 0],
    ]);
    const [tl, dl, pl] = o.lines;

    // Validação: quantidade acima do que falta, linha repetida, linha de outra encomenda, lista vazia, zero.
    const other = await confirmed([[drum.id, 1]]);
    await step(o.id, "ship", { lines: [{ lineId: tl.id, quantity: 6 }] }).expect(400);
    await step(o.id, "ship", { lines: [{ lineId: dl.id, quantity: 1 }, { lineId: dl.id, quantity: 1 }] }).expect(400);
    await step(o.id, "ship", { lines: [{ lineId: other.lines[0].id, quantity: 1 }] }).expect(400);
    await step(o.id, "ship", { lines: [] }).expect(400);
    await step(o.id, "ship", { lines: [{ lineId: dl.id, quantity: 0 }] }).expect(400);
    // Mais do que o reservado pede «enviar mesmo assim».
    await step(o.id, "ship", { lines: [{ lineId: tl.id, quantity: 4 }] }).expect(409);

    // Pela ordem das linhas, seja qual for a ordem do pedido.
    const partial = (await step(o.id, "ship", { lines: [{ lineId: dl.id, quantity: 1 }, { lineId: tl.id, quantity: 3 }], trackingCode: "X1" }).expect(200)).body as OrderView;
    expect(partial.status).toBe("CONFIRMED");
    expect(partial.partiallyShipped).toBe(true);
    expect(partial.shipments[0].lines.map((l) => [l.orderLineId, l.quantity])).toEqual([
      [tl.id, 3],
      [dl.id, 1],
    ]);
    expect(await linesOf(o.id)).toEqual([
      [3, 2, 0, 2],
      [1, 1, 1, 0],
      [0, 1, 0, 0],
    ]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 0, reserved: 0 });
    expect(await product(drum.id)).toMatchObject({ stockOnHand: 1, reserved: 1 });
    expect((await notes(o.id)).slice(-3)).toEqual(["Envio parcial: 3 × Toner preto (TN-2420); 1 × Tambor (DR-2400)", "Expedição: código X1", "Saída de stock: 3 × Toner preto (TN-2420); 1 × Tambor (DR-2400)"]);
    expect((await prisma().stockMovement.findMany({ where: { sourceId: o.id }, orderBy: { createdAt: "asc" } })).map((m) => m.reason)).toEqual([`${o.code}: envio parcial`, `${o.code}: envio parcial`]);
    expect((await list({ partiallyShipped: "true" })).map((x) => x.id)).toEqual([o.id]);
    expect((await list({ waiting: "true" })).map((x) => x.id).sort()).toEqual([o.id, other.id].sort());
    expect((await list({})).find((x) => x.id === o.id)!.partiallyShipped).toBe(true);
    await assertConsistent(o.id);

    // As sugestões de compra só contam o que falta enviar.
    const suggestions = (await api().get("/purchase-orders/suggestions").set("Authorization", admin).expect(200)).body.items;
    expect(suggestions.find((i: { product: { sku: string } }) => i.product.sku === "TN-2420")).toMatchObject({ waiting: 2, need: 2 });

    // Cancelar com parte enviada: recusado.
    await step(o.id, "cancel", { reason: "já não quer" }).expect(409);

    // Entrada de stock: serve só o que falta enviar, e a encomenda fica completa (tarefa «Preparar encomenda»).
    await move(toner.id, "PURCHASE_IN", 5);
    expect(await linesOf(o.id)).toEqual([
      [3, 2, 2, 0],
      [1, 1, 1, 0],
      [0, 1, 0, 0],
    ]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 5, reserved: 2, available: 3 });
    // Só falta enviar o que ficou reservado: a encomenda fica com tudo reservado (nota da regra do 6b).
    expect(await notes(o.id)).toContain("Todo o stock da encomenda está reservado");
    expect(await prisma().workItem.count({ where: { salesOrderId: o.id, typeId: "PREPARAR_ENCOMENDA" } })).toBe(1);
    expect((await list({ ready: "true" })).map((x) => x.id)).toContain(o.id);

    // O resto, sem linhas no pedido: fecha a encomenda.
    const rest = (await step(o.id, "ship").expect(200)).body as OrderView;
    expect(rest.status).toBe("SHIPPED");
    expect(rest.partiallyShipped).toBe(false);
    expect(rest.shipments).toHaveLength(2);
    expect(rest.shipments[1].lines.map((l) => [l.orderLineId, l.quantity])).toEqual([
      [tl.id, 2],
      [dl.id, 1],
      [pl.id, 1],
    ]);
    expect(await linesOf(o.id)).toEqual([
      [5, 0, 0, 0],
      [2, 0, 0, 0],
      [1, 0, 0, 0],
    ]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 3, reserved: 0 });
    expect(await product(drum.id)).toMatchObject({ stockOnHand: 0, reserved: 0 });
    await assertConsistent(o.id);
    expect((await list({ partiallyShipped: "true" })).map((x) => x.id)).toEqual([]);
    expect((await list({})).find((x) => x.id === o.id)!.partiallyShipped).toBe(false);
  });

  it("falta de stock num envio parcial: com «enviar mesmo assim» o stock fica negativo; linhas avulsas e sem controlo de stock", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    const service = await newProduct({ sku: "SRV", name: "Instalação", tracksStock: false });
    await move(toner.id, "INITIAL", 1);
    const o = await confirmed([[toner.id, 4], [service.id, 1], "avulsa"]);
    const [tl, sl, pl] = o.lines;

    const res = (await step(o.id, "ship", { lines: [{ lineId: tl.id, quantity: 3 }, { lineId: sl.id, quantity: 1 }], allowShortage: true }).expect(200)).body as OrderView;
    expect(res.status).toBe("CONFIRMED");
    expect(await linesOf(o.id)).toEqual([
      [3, 1, 0, 1],
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: -2, reserved: 0 });
    expect((await notes(o.id)).slice(-3)).toEqual(["Envio parcial: 3 × Toner preto (TN-2420); 1 × Instalação (SRV)", "Saída de stock: 3 × Toner preto (TN-2420)", "Enviada sem stock reservado para: 2 × Toner preto (TN-2420)"]);

    // Só as linhas avulsas: não pede stock.
    await step(o.id, "ship", { lines: [{ lineId: pl.id, quantity: 1 }] }).expect(200);
    // O resto do toner, sem stock: recusado, depois aceite.
    await step(o.id, "ship").expect(409);
    const done = (await step(o.id, "ship", { allowShortage: true }).expect(200)).body as OrderView;
    expect(done.status).toBe("SHIPPED");
    expect(done.shipments).toHaveLength(3);
    await assertConsistent(o.id);
  });

  it("«dar por enviada sem o resto»: liberta as reservas para quem aguarda; só com parte enviada", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    await move(toner.id, "INITIAL", 4);
    const a = await confirmed([[toner.id, 4], "avulsa"]);
    const b = await confirmed([[toner.id, 2]]);
    expect(await linesOf(b.id)).toEqual([[0, 2, 0, 2]]);

    await step(a.id, "finish", { reason: "não vai" }).expect(409); // nada enviado: cancela-se
    await step(a.id, "ship", { lines: [{ lineId: a.lines[0].id, quantity: 1 }] }).expect(200);
    await step(a.id, "finish", { reason: "  " }).expect(400);
    const finished = (await step(a.id, "finish", { reason: "O cliente já não precisa do resto" }).expect(200)).body as OrderView;
    expect(finished.status).toBe("SHIPPED");
    expect(await linesOf(a.id)).toEqual([
      [1, 3, 0, 0],
      [0, 1, 0, 0],
    ]);
    expect((await notes(a.id)).slice(-3)).toEqual(["Dada por enviada sem o resto: O cliente já não precisa do resto", "Não vai: 3 × Toner preto (TN-2420); 1 × Portes", "Reservas libertadas: 3 × Toner preto (TN-2420)"]);
    // As 3 libertadas: 2 vão para a B, que fica completa.
    expect(await linesOf(b.id)).toEqual([[0, 2, 2, 0]]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 3, reserved: 2, available: 1 });
    expect(await prisma().workItem.count({ where: { salesOrderId: b.id, typeId: "PREPARAR_ENCOMENDA" } })).toBe(1);
    await step(a.id, "finish", { reason: "outra vez" }).expect(409);
    await step(a.id, "deliver").expect(200);
    await assertConsistent(a.id);
    await assertConsistent(b.id);
  });

  it("corrigir a expedição: o código chega depois; transportadora inativa só se já era a dela; fica na timeline", async () => {
    const ctt = await carrier();
    const dpd = await carrier({ name: "DPD", trackingUrlTemplate: "https://dpd.exemplo.pt/{codigo}/estado" });
    const p = await newProduct({ tracksStock: false });
    const o = await confirmed([[p.id, 1]]);
    const shipped = (await step(o.id, "ship", { carrierId: ctt.id }).expect(200)).body as OrderView;
    const sid = shipped.shipments[0].id;
    expect(shipped.shipments[0].trackingUrl).toBeNull();
    await step(o.id, "deliver").expect(200);

    await api().patch(`/carriers/${ctt.id}`).set("Authorization", admin).send({ active: false }).expect(200);
    // Ainda é a dela: pode ficar; trocar por uma inativa, não.
    const patch = (body: Record<string, unknown>, auth = comercial) => api().patch(`/orders/${o.id}/shipments/${sid}`).set("Authorization", auth).send(body);
    let view = (await patch({ trackingCode: "RR123PT", carrierId: ctt.id }).expect(200)).body as OrderView;
    expect(view.shipments[0]).toMatchObject({ trackingCode: "RR123PT", trackingUrl: "https://seguir.exemplo.pt/?n=RR123PT" });
    view = (await patch({ carrierId: dpd.id, packages: 1 }).expect(200)).body as OrderView;
    expect(view.shipments[0]).toMatchObject({ carrier: { name: "DPD" }, trackingUrl: "https://dpd.exemplo.pt/RR123PT/estado", packages: 1 });
    await patch({ carrierId: ctt.id }).expect(400);
    view = (await patch({ carrierId: null, trackingCode: null, packages: null }).expect(200)).body as OrderView;
    expect(view.shipments[0]).toMatchObject({ carrier: null, trackingCode: null, packages: null, trackingUrl: null });
    await patch({ packages: 0 }).expect(400);
    await patch({ cost: -1 }).expect(400);
    await patch({ trackingCode: "X" }, tecnico).expect(403);
    await api().patch(`/orders/${o.id}/shipments/nao-existe`).set("Authorization", comercial).send({ trackingCode: "X" }).expect(404);
    const before = (await notes(o.id)).length;
    await patch({ notes: null }).expect(200); // sem mudança: nada na timeline
    expect((await notes(o.id)).length).toBe(before);
    expect((await notes(o.id)).filter((n) => n?.startsWith("Expedição corrigida"))).toEqual([
      "Expedição corrigida: CTT Expresso · código RR123PT",
      "Expedição corrigida: DPD · código RR123PT · 1 volume",
      "Expedição corrigida (sem dados do transporte)",
    ]);
  });

  it("com o módulo «Stock» desligado: expedições sem movimentos nem reservas", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    await move(toner.id, "INITIAL", 1);
    await api().patch("/modules/compras").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: false }).expect(200);
    const o = await confirmed([[toner.id, 3]]);
    await step(o.id, "ship", { lines: [{ lineId: o.lines[0].id, quantity: 2 }] }).expect(200);
    // O «aguarda» vem calculado (a interface só o mostra com o «Stock» ligado), mas não há reservas nem saídas.
    expect(await linesOf(o.id)).toEqual([[2, 1, 0, 1]]);
    expect(await prisma().stockMovement.count({ where: { type: "SALE_OUT" } })).toBe(0);
    expect((await step(o.id, "ship").expect(200)).body.status).toBe("SHIPPED");
    await assertConsistent(o.id);
  });

  it("webhooks: encomenda criada, mudanças de estado, expedições (sem o custo) e correções", async () => {
    const sub = (await api().post("/webhooks/subscriptions").set("Authorization", admin).send({ name: "loja", url: "http://127.0.0.1:9/hook", events: ["*"] }).expect(201)).body;
    const ctt = await carrier();
    const p = await newProduct({ tracksStock: false, sku: "SRV" });
    const o = await confirmed([[p.id, 3]]);
    const partial = (await step(o.id, "ship", { lines: [{ lineId: o.lines[0].id, quantity: 1 }], carrierId: ctt.id, trackingCode: "A1", cost: 5 }).expect(200)).body as OrderView;
    await api().patch(`/orders/${o.id}/shipments/${partial.shipments[0].id}`).set("Authorization", comercial).send({ trackingCode: "A2" }).expect(200);
    // Sem mudança: nenhum evento.
    await api().patch(`/orders/${o.id}/shipments/${partial.shipments[0].id}`).set("Authorization", comercial).send({ trackingCode: "A2" }).expect(200);
    await step(o.id, "ship").expect(200);
    await step(o.id, "deliver").expect(200);
    const c = await confirmed([[p.id, 1]]);
    await step(c.id, "cancel", { reason: "Desistiu" }).expect(200);
    const d = (await api().post("/orders").set("Authorization", comercial).send({ companyId }).expect(201)).body as { id: string };
    await step(d.id, "cancel", { reason: "Engano" }).expect(200);

    const deliveries = async () => {
      for (let i = 0; i < 80; i++) {
        const rows = await prisma().webhookDelivery.findMany({ where: { subscriptionId: sub.id }, orderBy: { createdAt: "asc" } });
        if (rows.length >= 12) return rows;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("faltam entregas");
    };
    const rows = await deliveries();
    type Envelope = { type: string; data: Record<string, unknown> };
    const events = rows.map((r) => r.payload as unknown as Envelope);
    const forOrder = (id: string) => events.filter((e) => e.data.order_id === id);
    expect(forOrder(o.id).map((e) => e.type).sort()).toEqual(
      ["order.created", "order.status_changed", "order.shipped", "order.shipment_updated", "order.shipped", "order.status_changed", "order.status_changed"].sort(),
    );
    expect(forOrder(c.id).map((e) => [e.type, e.data.from ?? null, e.data.to ?? null])).toEqual(
      expect.arrayContaining([
        ["order.created", null, null],
        ["order.status_changed", "DRAFT", "CONFIRMED"],
        ["order.status_changed", "CONFIRMED", "CANCELLED"],
      ]),
    );
    expect(forOrder(c.id).find((e) => e.data.to === "CANCELLED")!.data.reason).toBe("Desistiu");
    expect(forOrder(d.id).map((e) => [e.type, e.data.from ?? null, e.data.to ?? null])).toEqual(
      expect.arrayContaining([["order.status_changed", "DRAFT", "CANCELLED"]]),
    );
    const created = forOrder(o.id).find((e) => e.type === "order.created")!;
    expect(created.data).toMatchObject({ code: o.code, status: "DRAFT", company_id: companyId, customer_reference: "PO-77" });

    const shipped = forOrder(o.id).filter((e) => e.type === "order.shipped");
    const first = shipped.find((e) => e.data.partial === true)!;
    expect(first.data).toMatchObject({
      status: "CONFIRMED",
      shipment: { carrier: "CTT Expresso", tracking_code: "A1", tracking_url: "https://seguir.exemplo.pt/?n=A1", lines: [{ order_line_id: o.lines[0].id, product_id: p.id, sku: "SRV", quantity: 1 }] },
    });
    expect(JSON.stringify(shipped)).not.toContain("cost");
    expect(shipped.find((e) => e.data.partial === false)!.data).toMatchObject({ status: "SHIPPED", shipment: { lines: [{ quantity: 2 }] } });
    expect(forOrder(o.id).find((e) => e.type === "order.shipment_updated")!.data).toMatchObject({ shipment: { tracking_code: "A2" } });
    expect(forOrder(o.id).filter((e) => e.type === "order.status_changed").map((e) => [e.data.from, e.data.to])).toEqual(
      expect.arrayContaining([
        ["DRAFT", "CONFIRMED"],
        ["CONFIRMED", "SHIPPED"],
        ["SHIPPED", "DELIVERED"],
      ]),
    );
    // Os eventos estão no catálogo.
    const catalog = (await api().get("/webhooks/events").set("Authorization", admin).expect(200)).body.map((e: { type: string }) => e.type);
    expect(catalog).toEqual(expect.arrayContaining(["order.created", "order.status_changed", "order.shipped", "order.shipment_updated"]));

    // As primeiras tentativas (para um endereço que recusa) acabam antes do teste seguinte limpar a base.
    for (let i = 0; i < 100; i++) {
      const busy = await prisma().webhookDelivery.count({ where: { subscriptionId: sub.id, OR: [{ attempts: 0 }, { lockedUntil: { not: null } }] } });
      if (busy === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it("concorrência: dois envios parciais da mesma linha ao mesmo tempo nunca passam da quantidade", async () => {
    const toner = await newProduct({ sku: "TN-2420" });
    await move(toner.id, "INITIAL", 5);
    const o = await confirmed([[toner.id, 5]]);
    const results = await Promise.all([1, 2].map(() => step(o.id, "ship", { lines: [{ lineId: o.lines[0].id, quantity: 3 }] })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await linesOf(o.id)).toEqual([[3, 2, 2, 0]]);
    expect(await product(toner.id)).toMatchObject({ stockOnHand: 2, reserved: 2 });
    // Dois «enviar o resto» ao mesmo tempo: um só.
    const rest = await Promise.all([1, 2].map(() => step(o.id, "ship")));
    expect(rest.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma().shipment.count({ where: { orderId: o.id } })).toBe(2);
    await assertConsistent(o.id);
  });
});
