import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { Role } from "@prisma/client";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";

// Fase 6a (docs/plano-fase-6-encomendas.md): encomendas de cliente.
describe("Encomendas (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let comercial: string;
  let comercialId: string;
  const as = async (role: Role) => bearerFor(app, await createUser(prisma(), role));

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    const user = await createUser(prisma(), "COMERCIAL", "Carla Comercial");
    comercialId = user.id;
    comercial = await bearerFor(app, user);
  });

  afterAll(async () => {
    await app.close();
  });

  const company = async (name = "Gráfica São João", taxId?: string) => (await api().post("/companies").set("Authorization", admin).send({ name, taxId }).expect(201)).body as { id: string };
  const newProduct = async (body: Record<string, unknown> = {}) =>
    (await api().post("/products").set("Authorization", admin).send({ sku: `p-${Math.random().toString(36).slice(2, 8)}`, name: "Toner preto", salePrice: 45.9, vatRate: 23, ...body }).expect(201)).body as {
      id: string;
      sku: string;
    };
  const newOrder = async (body: Record<string, unknown>, auth = comercial) => (await api().post("/orders").set("Authorization", auth).send(body).expect(201)).body;
  const addLine = (orderId: string, body: Record<string, unknown>, auth = comercial) => api().post(`/orders/${orderId}/lines`).set("Authorization", auth).send(body);
  const step = (orderId: string, action: string, auth = comercial, body?: Record<string, unknown>) => api().post(`/orders/${orderId}/${action}`).set("Authorization", auth).send(body ?? {});
  const notes = async (id: string) => (await prisma().timelineEvent.findMany({ where: { entityType: "ORDER", entityId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((e) => e.description);

  it("cria o rascunho; linhas do catálogo e avulsas; totais com desconto e IVA, arredondados por linha", async () => {
    const c = await company();
    const p = await newProduct();
    const order = await newOrder({ companyId: c.id, customerReference: " PO-778 ", notes: "Entregar de manhã" });
    expect(order).toMatchObject({ code: "EN-0001", status: "DRAFT", company: { id: c.id, name: "Gráfica São João" }, customerReference: "PO-778", subtotal: 0, total: 0, lines: [] });

    // Do catálogo: referência, nome, preço e IVA do produto.
    let o = (await addLine(order.id, { productId: p.id, quantity: 3 }).expect(201)).body;
    expect(o.lines[0]).toMatchObject({ productId: p.id, sku: p.sku.toUpperCase(), description: "Toner preto", quantity: 3, unitPrice: 45.9, discountPct: 0, vatRate: 23, lineTotal: 137.7, vatAmount: 31.67 });
    // Avulsa com desconto e IVA reduzido: 1,5 × 10,01 −12,5% = 13,138… → 13,14; IVA 6% = 0,79.
    o = (await addLine(order.id, { description: "Portes", quantity: 1.5, unitPrice: 10.01, discountPct: 12.5, vatRate: 6 }).expect(201)).body;
    expect(o.lines[1]).toMatchObject({ productId: null, sku: null, position: 1, lineTotal: 13.14, vatAmount: 0.79 });
    expect(o).toMatchObject({ subtotal: 150.84, vatTotal: 32.46, total: 183.3 });

    // Sem referência (como a interface envia: `null`), e do catálogo sem a referência do produto.
    expect((await addLine(order.id, { description: "Embalagem", sku: null, quantity: 1, unitPrice: 0, vatRate: 23 }).expect(201)).body.lines[2].sku).toBeNull();
    o = (await api().delete(`/orders/${order.id}/lines/${(await prisma().salesOrderLine.findFirstOrThrow({ where: { orderId: order.id, description: "Embalagem" } })).id}`).set("Authorization", comercial).expect(200)).body;

    // O que vem no pedido prevalece sobre o produto.
    o = (await addLine(order.id, { productId: p.id, quantity: 1, unitPrice: 40, description: "Toner preto (promoção)", vatRate: 23 }).expect(201)).body;
    expect(o.lines[2]).toMatchObject({ unitPrice: 40, description: "Toner preto (promoção)", lineTotal: 40 });
    expect(o.total).toBe(232.5);

    // Alterar e retirar recalculam.
    o = (await api().patch(`/orders/${order.id}/lines/${o.lines[2].id}`).set("Authorization", comercial).send({ quantity: 2, discountPct: 50 }).expect(200)).body;
    expect(o.lines[2].lineTotal).toBe(40);
    o = (await api().delete(`/orders/${order.id}/lines/${o.lines[1].id}`).set("Authorization", comercial).expect(200)).body;
    expect(o).toMatchObject({ subtotal: 177.7, vatTotal: 40.87, total: 218.57 });
    expect(o.lines.map((l: { position: number }) => l.position)).toEqual([0, 2]);

    // Os totais guardados batem com as linhas.
    const row = await prisma().salesOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect([Number(row.subtotal), Number(row.vatTotal), Number(row.total)]).toEqual([177.7, 40.87, 218.57]);

    expect(await notes(order.id)).toEqual([
      "Encomenda EN-0001 criada",
      `Linha acrescentada: 3 × Toner preto (${p.sku.toUpperCase()}) a 45,90 €`,
      "Linha acrescentada: 1,5 × Portes a 10,01 € −12,5%",
      "Linha acrescentada: 1 × Embalagem a 0,00 €",
      "Linha retirada: 1 × Embalagem a 0,00 €",
      `Linha acrescentada: 1 × Toner preto (promoção) (${p.sku.toUpperCase()}) a 40,00 €`,
      `Linha alterada: 1 × Toner preto (promoção) (${p.sku.toUpperCase()}) a 40,00 € → 2 × Toner preto (promoção) (${p.sku.toUpperCase()}) a 40,00 € −50%`,
      "Linha retirada: 1,5 × Portes a 10,01 € −12,5%",
    ]);
  });

  it("validações: cliente obrigatório e coerente, produto ativo e com preço, linha avulsa completa, limites", async () => {
    const c = await company();
    const other = await company("Outra Lda");
    const contact = (await api().post("/contacts").set("Authorization", admin).send({ name: "Ana", companyId: other.id }).expect(201)).body;
    await api().post("/orders").set("Authorization", comercial).send({}).expect(400);
    await api().post("/orders").set("Authorization", comercial).send({ companyId: "nao-existe" }).expect(400);
    await api().post("/orders").set("Authorization", comercial).send({ companyId: c.id, contactId: contact.id }).expect(400);
    // Só o contacto também serve.
    expect((await newOrder({ contactId: contact.id })).contact).toMatchObject({ id: contact.id, name: "Ana" });
    const order = await newOrder({ companyId: c.id });

    await addLine(order.id, { description: "Sem preço", quantity: 1, vatRate: 23 }).expect(400);
    await addLine(order.id, { description: "Sem IVA", quantity: 1, unitPrice: 1 }).expect(400);
    await addLine(order.id, { quantity: 1, unitPrice: 1, vatRate: 23 }).expect(400);
    for (const bad of [{ quantity: 0 }, { quantity: -1 }, { quantity: 1.234 }, { quantity: 1, unitPrice: -1 }, { quantity: 1, discountPct: 101 }, { quantity: 1, vatRate: 150 }]) {
      await addLine(order.id, { description: "X", unitPrice: 1, vatRate: 23, ...bad }).expect(400);
    }
    const noPrice = await newProduct({ salePrice: null });
    await addLine(order.id, { productId: noPrice.id, quantity: 1 }).expect(400);
    expect((await addLine(order.id, { productId: noPrice.id, quantity: 1, unitPrice: 5 }).expect(201)).body.lines[0].unitPrice).toBe(5);
    const inactive = await newProduct({ active: false });
    await addLine(order.id, { productId: inactive.id, quantity: 1 }).expect(400);
    await addLine(order.id, { productId: "nao-existe", quantity: 1 }).expect(400);

    // A base de dados também o garante.
    await expect(prisma().$executeRawUnsafe(`UPDATE "SalesOrder" SET "companyId" = NULL, "contactId" = NULL WHERE "id" = '${order.id}'`)).rejects.toThrow(/SalesOrder_tem_cliente/);
    await expect(prisma().$executeRawUnsafe(`UPDATE "SalesOrder" SET "status" = 'CANCELLED' WHERE "id" = '${order.id}'`)).rejects.toThrow(/SalesOrder_cancelada_com_motivo/);
    await expect(prisma().$executeRawUnsafe(`UPDATE "SalesOrder" SET "total" = 1 WHERE "id" = '${order.id}'`)).rejects.toThrow(/SalesOrder_totais/);
    await expect(prisma().$executeRawUnsafe(`UPDATE "SalesOrderLine" SET "quantity" = 0 WHERE "orderId" = '${order.id}'`)).rejects.toThrow(/SalesOrderLine_limites/);
  });

  it("estados: confirmar (com linhas), enviar, entregar; não se salta nem se volta atrás; linhas só em rascunho", async () => {
    const c = await company();
    const order = await newOrder({ companyId: c.id });
    await step(order.id, "confirm").expect(400); // sem linhas
    const line = (await addLine(order.id, { description: "Serviço", quantity: 1, unitPrice: 100, vatRate: 23 }).expect(201)).body.lines[0];
    await step(order.id, "ship").expect(409);
    const confirmed = (await step(order.id, "confirm").expect(200)).body;
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.confirmedAt).toBeTruthy();

    await addLine(order.id, { description: "Mais", quantity: 1, unitPrice: 1, vatRate: 23 }).expect(409);
    await api().patch(`/orders/${order.id}/lines/${line.id}`).set("Authorization", comercial).send({ quantity: 2 }).expect(409);
    await api().delete(`/orders/${order.id}/lines/${line.id}`).set("Authorization", comercial).expect(409);
    // O cliente só muda em rascunho; o resto do cabeçalho ainda muda.
    const outra = await company("Outra"); // fora do pedido: dois pedidos supertest sobrepostos fecham o servidor um ao outro
    await api().patch(`/orders/${order.id}`).set("Authorization", comercial).send({ companyId: outra.id }).expect(409);
    await api().patch(`/orders/${order.id}`).set("Authorization", comercial).send({ deliveryAddress: "Rua A, 1", assigneeId: comercialId }).expect(200);
    await api().delete(`/orders/${order.id}`).set("Authorization", admin).expect(409);

    await step(order.id, "confirm").expect(409);
    await step(order.id, "deliver").expect(409);
    expect((await step(order.id, "ship").expect(200)).body.status).toBe("SHIPPED");
    await step(order.id, "cancel", comercial, { reason: "Tarde demais" }).expect(409);
    const delivered = (await step(order.id, "deliver").expect(200)).body;
    expect(delivered).toMatchObject({ status: "DELIVERED", assignee: { id: comercialId } });
    await api().patch(`/orders/${order.id}`).set("Authorization", comercial).send({ notes: "x" }).expect(409);

    expect(await notes(order.id)).toEqual(["Encomenda EN-0001 criada", "Linha acrescentada: 1 × Serviço a 100,00 €", "Encomenda confirmada", "Responsável: Carla Comercial", "Encomenda enviada", "Encomenda entregue"]);
    const audit = await prisma().auditEvent.findMany({ where: { targetId: order.id }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(["order.confirmed", "order.shipped"]);
  });

  it("cancelar com motivo (rascunho ou confirmada); apagar só rascunhos; empresa, contacto e produto com encomendas não se apagam", async () => {
    const c = await company();
    const p = await newProduct();
    const a = await newOrder({ companyId: c.id });
    await addLine(a.id, { productId: p.id, quantity: 1 }).expect(201);
    await step(a.id, "confirm").expect(200);
    await step(a.id, "cancel", comercial, {}).expect(400);
    await step(a.id, "cancel", comercial, { reason: "  " }).expect(400);
    const cancelled = (await step(a.id, "cancel", comercial, { reason: " Cliente desistiu " }).expect(200)).body;
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancelReason: "Cliente desistiu" });
    await step(a.id, "cancel", comercial, { reason: "De novo" }).expect(409);
    await step(a.id, "ship").expect(409);
    expect((await prisma().auditEvent.findFirstOrThrow({ where: { targetId: a.id, action: "order.cancelled" } })).metadata).toMatchObject({ reason: " Cliente desistiu " });

    await api().delete(`/companies/${c.id}`).set("Authorization", admin).expect(409);
    await api().delete(`/products/${p.id}`).set("Authorization", admin).expect(409);
    const contact = (await api().post("/contacts").set("Authorization", admin).send({ name: "Rui" }).expect(201)).body;
    const b = await newOrder({ contactId: contact.id });
    await api().delete(`/contacts/${contact.id}`).set("Authorization", admin).expect(409);

    // Rascunho apaga-se (com os valores dos campos personalizados).
    const field = (await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "ORDER", fieldLabel: "Canal", fieldType: "TEXT" }).expect(201)).body;
    await api().post("/custom-fields/values").set("Authorization", comercial).send({ entityType: "ORDER", entityId: b.id, values: [{ customFieldId: field.id, value: "Loja" }] }).expect(201);
    await api().delete(`/orders/${b.id}`).set("Authorization", comercial).expect(204);
    expect(await prisma().customFieldValue.count({ where: { entityType: "ORDER", entityId: b.id } })).toBe(0);
    await api().delete(`/contacts/${contact.id}`).set("Authorization", admin).expect(204);
  });

  it("lista: mais recentes primeiro, pesquisa por número, referência e cliente, filtros e paginação", async () => {
    const acme = await company("Acme Impressão", "509999990");
    const joao = await company("Gráfica São João");
    const a = await newOrder({ companyId: acme.id, customerReference: "PO-AC-1" });
    const b = await newOrder({ companyId: joao.id, assigneeId: comercialId });
    const c = await newOrder({ companyId: joao.id });
    await addLine(c.id, { description: "X", quantity: 1, unitPrice: 10, vatRate: 23 }).expect(201);
    await step(c.id, "confirm").expect(200);

    const list = async (query: Record<string, string | number>) => (await api().get("/orders").query(query).set("Authorization", admin).expect(200)).body;
    expect((await list({})).items.map((o: { code: string }) => o.code)).toEqual(["EN-0003", "EN-0002", "EN-0001"]);
    expect((await list({})).items[0]).toMatchObject({ lineCount: 1, total: 12.3, company: { name: "Gráfica São João" } });
    expect((await list({ search: "en-0002" })).items.map((o: { id: string }) => o.id)).toEqual([b.id]);
    expect((await list({ search: "2" })).items.map((o: { id: string }) => o.id)).toEqual([b.id]);
    expect((await list({ search: "po-ac" })).items.map((o: { id: string }) => o.id)).toEqual([a.id]);
    expect((await list({ search: "sao joao" })).items.map((o: { id: string }) => o.id)).toEqual([c.id, b.id]);
    expect((await list({ search: "509999990" })).items.map((o: { id: string }) => o.id)).toEqual([a.id]);
    expect((await list({ status: "CONFIRMED" })).items.map((o: { id: string }) => o.id)).toEqual([c.id]);
    expect((await list({ companyId: acme.id })).items.map((o: { id: string }) => o.id)).toEqual([a.id]);
    expect((await list({ assigneeId: comercialId })).items.map((o: { id: string }) => o.id)).toEqual([b.id]);
    await api().get("/orders").query({ status: "NOPE" }).set("Authorization", admin).expect(400);

    const first = await list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    const second = await list({ limit: 2, cursor: first.nextCursor });
    expect([...first.items, ...second.items].map((o: { id: string }) => o.id)).toEqual([c.id, b.id, a.id]);
  });

  it("permissões: área «Encomendas»; Técnico só vê; módulo desligado → 404; timeline da encomenda", async () => {
    const c = await company();
    const order = await newOrder({ companyId: c.id });
    const tecnico = await as("TECNICO");
    await api().get(`/orders/${order.id}`).set("Authorization", tecnico).expect(200);
    await api().get("/orders").set("Authorization", tecnico).expect(200);
    await api().post("/orders").set("Authorization", tecnico).send({ companyId: c.id }).expect(403);
    await addLine(order.id, { description: "X", quantity: 1, unitPrice: 1, vatRate: 23 }, tecnico).expect(403);
    await step(order.id, "confirm", tecnico).expect(403);
    await newOrder({ companyId: c.id }, await as("BACKOFFICE"));
    await api().post("/orders").set("Authorization", await as("FINANCEIRO")).send({ companyId: c.id }).expect(403);

    const timeline = (await api().get("/timeline").query({ entityType: "ORDER", entityId: order.id }).set("Authorization", tecnico).expect(200)).body;
    expect(timeline.items.map((e: { description: string }) => e.description)).toEqual(["Encomenda EN-0001 criada"]);

    await api().patch("/modules/encomendas").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().get("/orders").set("Authorization", admin).expect(404);
    await api().get("/custom-fields/values").query({ entityType: "ORDER", entityId: order.id }).set("Authorization", admin).expect(404);
    await api().patch("/modules/encomendas").set("Authorization", admin).send({ enabled: true }).expect(200);

    // As encomendas dependem dos produtos: com elas ligadas, os produtos não se desligam.
    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().patch("/modules/produtos").set("Authorization", admin).send({ enabled: false }).expect(400);
  });

  it("linhas em simultâneo: os totais batem sempre com as linhas (a encomenda é bloqueada)", async () => {
    const c = await company();
    const order = await newOrder({ companyId: c.id });
    await Promise.all(Array.from({ length: 8 }, (_, i) => addLine(order.id, { description: `L${i}`, quantity: 1, unitPrice: 10 + i, vatRate: 23 }).expect(201)));
    const o = (await api().get(`/orders/${order.id}`).set("Authorization", admin).expect(200)).body;
    expect(o.lines).toHaveLength(8);
    expect(new Set(o.lines.map((l: { position: number }) => l.position)).size).toBe(8);
    expect(o.subtotal).toBe(108);
    expect(o.total).toBe(132.84);
  });
});
