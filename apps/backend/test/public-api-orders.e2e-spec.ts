import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";
import { expectConforms } from "./openapi-conformance";

// Fase 6e (docs/plano-fase-6-encomendas.md, «Pacote 6e»): produtos e encomendas na API pública. Todas as respostas
// são validadas contra a especificação OpenAPI.
describe("API pública: produtos e encomendas (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let adminId: string;
  let key: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    const user = await createUser(prisma(), "ADMINISTRADOR", "Ana Admin");
    adminId = user.id;
    admin = await bearerFor(app, user);
    key = await newKey(["products:read", "orders:read", "orders:write"]);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newKey(scopes: string[], name = "Loja online") {
    return (await api().post("/api-keys").set("Authorization", admin).send({ name, scopes, rateLimitPerMinute: 1000 }).expect(201)).body.key as string;
  }
  const bearer = (k = key) => ({ Authorization: `Bearer ${k}` });
  let idem = 0;
  const nextIdem = () => `pedido-${Date.now()}-${++idem}`;
  const postOrder = (body: Record<string, unknown>, idempotencyKey = nextIdem(), k = key) =>
    api().post("/api/v1/orders").set({ ...bearer(k), "Idempotency-Key": idempotencyKey }).send(body);
  const created = async (body: Record<string, unknown>) => {
    const res = await postOrder(body);
    expectConforms(res, "POST", "/api/v1/orders");
    expect(res.status).toBe(201);
    return res.body.data as PublicOrder;
  };
  const newProduct = async (body: Record<string, unknown> = {}) =>
    (await api().post("/products").set("Authorization", admin).send({ sku: `p-${Math.random().toString(36).slice(2, 8)}`, name: "Toner preto", salePrice: 45.9, vatRate: 23, tracksStock: true, ...body }).expect(201)).body as { id: string; sku: string };
  const move = (productId: string, type: string, quantity: number) => api().post("/stock/movements").set("Authorization", admin).send({ productId, type, quantity, reason: "teste" }).expect(201);
  const notes = async (entityType: "ORDER" | "COMPANY" | "CONTACT", id: string) =>
    (await prisma().timelineEvent.findMany({ where: { entityType, entityId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((e) => e.description);
  const counts = async () => ({
    orders: await prisma().salesOrder.count(),
    companies: await prisma().company.count(),
    contacts: await prisma().contact.count(),
    links: await prisma().externalLink.count(),
  });
  const setModule = (id: string, enabled: boolean) => api().patch(`/modules/${id}`).set("Authorization", admin).send({ enabled }).expect(200);

  type PublicOrder = {
    id: string;
    code: string;
    status: string;
    partially_shipped: boolean;
    customer: { company_id: string | null; contact_id: string | null };
    customer_reference: string | null;
    subtotal: number;
    vat_total: number;
    total: number;
    external_id: string | null;
    lines: Array<{ id: string; product_id: string | null; sku: string | null; description: string; quantity: number; unit_price: number; vat_rate: number; line_total: number; shipped_quantity: number }>;
    shipments: Array<Record<string, unknown>>;
    updated_at: string;
  };

  describe("produtos", () => {
    it("lista, sincronização, filtro sku, stock (com e sem o módulo), sem custos; âmbito e módulo", async () => {
      const toner = await newProduct({ sku: "TN-2420", name: "Toner TN-2420", barcode: "5601234567890" });
      await new Promise((r) => setTimeout(r, 5));
      const servico = await newProduct({ sku: "SRV-1", name: "Instalação", tracksStock: false, salePrice: null });
      await move(toner.id, "INITIAL", 10);

      const all = await api().get("/api/v1/products").set(bearer());
      expectConforms(all, "GET", "/api/v1/products");
      expect(all.body.data.map((p: { sku: string }) => p.sku)).toEqual(["TN-2420", "SRV-1"]);
      const t = all.body.data[0];
      expect(t).toMatchObject({ id: toner.id, name: "Toner TN-2420", barcode: "5601234567890", unit: "UN", sale_price: 45.9, vat_rate: 23, active: true, tracks_stock: true, stock_on_hand: 10, reserved: 0, available: 10, category: null });
      expect(all.body.data[1]).toMatchObject({ sale_price: null, tracks_stock: false, stock_on_hand: null, reserved: null, available: null });
      // Nunca custos nem fornecedores.
      expect(JSON.stringify(all.body)).not.toMatch(/"[a-z_]*(cost|supplier|min_stock)[a-z_]*":/i);

      // Sincronização: página de 1 com cursor; e updated_since.
      const first = await api().get("/api/v1/products").query({ limit: 1 }).set(bearer()).expect(200);
      expect(first.body.data.map((p: { id: string }) => p.id)).toEqual([toner.id]);
      const second = await api().get("/api/v1/products").query({ limit: 1, cursor: first.body.next_cursor }).set(bearer()).expect(200);
      expect(second.body).toMatchObject({ data: [{ id: servico.id }], next_cursor: null });
      const since = (await prisma().product.findUniqueOrThrow({ where: { id: servico.id } })).updatedAt.toISOString();
      expect((await api().get("/api/v1/products").query({ updated_since: since }).set(bearer()).expect(200)).body.data.map((p: { id: string }) => p.id)).toEqual([servico.id]);

      // sku: exato, sem distinguir maiúsculas.
      expect((await api().get("/api/v1/products").query({ sku: "tn-2420" }).set(bearer()).expect(200)).body.data.map((p: { id: string }) => p.id)).toEqual([toner.id]);
      expect((await api().get("/api/v1/products").query({ sku: "TN" }).set(bearer()).expect(200)).body.data).toEqual([]);

      // Um.
      const one = await api().get(`/api/v1/products/${toner.id}`).set(bearer());
      expectConforms(one, "GET", "/api/v1/products/{id}");
      expect(one.body.data.available).toBe(10);
      expectConforms(await api().get("/api/v1/products/nao-existe").set(bearer()).expect(404), "GET", "/api/v1/products/{id}");

      // Âmbito em falta.
      const leadsOnly = await newKey(["leads:write"], "Formulário");
      expectConforms(await api().get("/api/v1/products").set(bearer(leadsOnly)).expect(403), "GET", "/api/v1/products");

      // Sem o módulo «Stock»: os campos de stock vêm a null.
      await setModule("compras", false);
      await setModule("stock", false);
      const noStock = await api().get(`/api/v1/products/${toner.id}`).set(bearer()).expect(200);
      expectConforms(noStock, "GET", "/api/v1/products/{id}");
      expect(noStock.body.data).toMatchObject({ tracks_stock: true, stock_on_hand: null, reserved: null, available: null });

      // Sem o módulo «Produtos»: 404 (as encomendas dependem dele).
      await setModule("encomendas", false);
      await setModule("produtos", false);
      expectConforms(await api().get("/api/v1/products").set(bearer()).expect(404), "GET", "/api/v1/products");
      await api().get(`/api/v1/products/${toner.id}`).set(bearer()).expect(404);
    });
  });

  describe("criar encomendas", () => {
    it("cliente existente pelo NIF normalizado e pelo email; linhas por sku e livres; preço da loja; totais; rascunho", async () => {
      const company = await prisma().company.create({ data: { name: "Gráfica São João", taxId: "PT 500 100 200" } });
      const contact = await prisma().contact.create({ data: { name: "Rita Sousa", email: "Rita@GraficaSJ.pt", companyId: company.id } });
      const toner = await newProduct({ sku: "TN-2420", name: "Toner TN-2420", salePrice: 45.9, vatRate: 23 });
      const papel = await newProduct({ sku: "PAP-A4", name: "Papel A4", salePrice: 4.5, vatRate: 23 });
      const before = await counts();

      const order = await created({
        external_id: "1001",
        customer: { tax_id: "500100200", email: "rita@graficasj.pt", company_name: "Outro nome", name: "Rita" },
        lines: [
          { sku: "tn-2420", quantity: 2 },
          { sku: "PAP-A4", quantity: 10, unit_price: 3.99, discount_pct: 10 },
          { description: "Portes", quantity: 1, unit_price: 5, vat_rate: 23 },
        ],
        delivery_address: "Rua das Flores, 1",
        notes: "Entregar de manhã",
      });

      expect(order).toMatchObject({
        status: "DRAFT",
        partially_shipped: false,
        customer: { company_id: company.id, contact_id: contact.id },
        customer_reference: "1001",
        external_id: "1001",
        shipments: [],
      });
      expect(order.lines.map((l) => [l.product_id, l.sku, l.description, l.quantity, l.unit_price, l.vat_rate, l.line_total])).toEqual([
        [toner.id, "TN-2420", "Toner TN-2420", 2, 45.9, 23, 91.8],
        [papel.id, "PAP-A4", "Papel A4", 10, 3.99, 23, 35.91],
        [null, null, "Portes", 1, 5, 23, 5],
      ]);
      // 91,80 + 35,91 + 5 = 132,71; IVA 21,11 + 8,26 + 1,15 = 30,52.
      expect([order.subtotal, order.vat_total, order.total]).toEqual([132.71, 30.52, 163.23]);
      // Nada de novo além da encomenda (e da ligação ao id externo).
      expect(await counts()).toEqual({ ...before, orders: 1, links: 1 });

      const row = await prisma().salesOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(row).toMatchObject({ createdById: adminId, assigneeId: null, deliveryAddress: "Rua das Flores, 1", notes: "Entregar de manhã" });
      const n = await notes("ORDER", order.id);
      expect(n[0]).toBe(`Encomenda ${order.code} criada pela API (chave «Loja online») (n.º na origem: 1001)`);
      expect(n[1]).toBe('Cliente: empresa "Gráfica São João" (encontrada pelo NIF) · contacto "Rita Sousa" (encontrado pelo email)');
      expect(n[2]).toMatch(/^Linhas: 2 × Toner TN-2420 \(TN-2420\)/);

      // Na interface, a ficha mostra de onde veio.
      const detail = (await api().get(`/orders/${order.id}`).set("Authorization", admin).expect(200)).body;
      expect(detail.externalRefs).toEqual([{ source: "Loja online", externalId: "1001" }]);
    });

    it("cliente novo: cria empresa e contacto (com timeline); a segunda encomenda reutiliza-os", async () => {
      await newProduct({ sku: "TN-1" });
      const first = await created({
        customer: { tax_id: "PT509999990", email: "joao@novaloja.pt", company_name: "Nova Loja Lda", name: "João Lopes", phone: "912345678" },
        lines: [{ sku: "TN-1", quantity: 1 }],
      });
      const company = await prisma().company.findUniqueOrThrow({ where: { id: first.customer.company_id! } });
      const contact = await prisma().contact.findUniqueOrThrow({ where: { id: first.customer.contact_id! } });
      expect(company).toMatchObject({ name: "Nova Loja Lda", taxId: "PT509999990" });
      expect(contact).toMatchObject({ name: "João Lopes", email: "joao@novaloja.pt", phone: "912345678", companyId: company.id });
      expect(await notes("COMPANY", company.id)).toEqual([`Empresa "Nova Loja Lda" criada pela API (chave «Loja online»), com a encomenda ${first.code}.`]);
      expect(await notes("CONTACT", contact.id)).toEqual([`Contacto "João Lopes" criado pela API (chave «Loja online»), com a encomenda ${first.code}.`]);
      expect((await notes("ORDER", first.id))[1]).toBe('Cliente: empresa "Nova Loja Lda" (criada) · contacto "João Lopes" (criado)');
      expect(first.customer_reference).toBeNull();

      const second = await created({ customer: { tax_id: "509 999 990", email: "JOAO@novaloja.pt", company_name: "Nova Loja" }, lines: [{ sku: "TN-1", quantity: 1 }] });
      expect(second.customer).toEqual(first.customer);
      expect(await prisma().company.count()).toBe(1);
      expect(await prisma().contact.count()).toBe(1);
    });

    it("contacto de outra empresa não entra; contacto sem empresa ganha a da encomenda; sem NIF usa a empresa do contacto; só pessoa", async () => {
      await newProduct({ sku: "TN-1" });
      const beta = await prisma().company.create({ data: { name: "Beta", taxId: "500000001" } });
      const gama = await prisma().company.create({ data: { name: "Gama", taxId: "500000002" } });
      await prisma().contact.create({ data: { name: "Paulo", email: "paulo@beta.pt", companyId: beta.id } });
      const solto = await prisma().contact.create({ data: { name: "Solto", email: "solto@mail.pt" } });

      // NIF da Gama, email de um contacto da Beta: fica só a empresa; a timeline diz porquê.
      const a = await created({ customer: { tax_id: "500000002", email: "paulo@beta.pt" }, lines: [{ sku: "TN-1", quantity: 1 }] });
      expect(a.customer).toEqual({ company_id: gama.id, contact_id: null });
      expect(await notes("ORDER", a.id)).toContain('O contacto com o email paulo@beta.pt ("Paulo") é de outra empresa ("Beta"): não fica na encomenda');

      // Contacto sem empresa: ganha a da encomenda.
      const b = await created({ customer: { tax_id: "500000002", email: "solto@mail.pt" }, lines: [{ sku: "TN-1", quantity: 1 }] });
      expect(b.customer).toEqual({ company_id: gama.id, contact_id: solto.id });
      expect((await prisma().contact.findUniqueOrThrow({ where: { id: solto.id } })).companyId).toBe(gama.id);

      // Sem NIF mas com nome de empresa: a do contacto que a loja já conhece (não cria outra «Beta»).
      const c = await created({ customer: { email: "paulo@beta.pt", company_name: "Beta Lda" }, lines: [{ sku: "TN-1", quantity: 1 }] });
      expect(c.customer).toMatchObject({ company_id: beta.id });
      expect(await prisma().company.count()).toBe(2);

      // Só uma pessoa: contacto criado, sem empresa.
      const d = await created({ customer: { name: "Maria Cliente", email: "maria@mail.pt" }, lines: [{ sku: "TN-1", quantity: 1 }] });
      expect(d.customer.company_id).toBeNull();
      expect((await prisma().contact.findUniqueOrThrow({ where: { id: d.customer.contact_id! } })).name).toBe("Maria Cliente");

      // NIF desconhecido sem nome de empresa, com email novo: contacto criado; o NIF fica na timeline.
      const e = await created({ customer: { tax_id: "123456789", email: "x@y.pt" }, lines: [{ sku: "TN-1", quantity: 1 }] });
      expect(e.customer.company_id).toBeNull();
      expect(await notes("ORDER", e.id)).toContain("NIF indicado: 123456789 (não há empresa com este NIF e não veio o nome da empresa para a criar)");

      // Com NIF (desconhecido) e nome de empresa: cria a empresa desse NIF, mesmo que o contacto seja de outra.
      const f = await created({ customer: { tax_id: "500000003", company_name: "Delta", email: "paulo@beta.pt" }, lines: [{ sku: "TN-1", quantity: 1 }] });
      const delta = await prisma().company.findFirstOrThrow({ where: { taxId: "500000003" } });
      expect(f.customer).toEqual({ company_id: delta.id, contact_id: null });
    });

    it("confirm: nasce confirmada e reserva stock; o que falta aguarda; webhooks created + status_changed", async () => {
      const sub = (await api().post("/webhooks/subscriptions").set("Authorization", admin).send({ name: "loja", url: "http://127.0.0.1:9/hook", events: ["order.created", "order.status_changed"] }).expect(201)).body;
      const toner = await newProduct({ sku: "TN-1" });
      const servico = await newProduct({ sku: "SRV", tracksStock: false });
      await move(toner.id, "INITIAL", 2);

      const order = await created({ confirm: true, external_id: "2002", customer: { name: "Ana", email: "ana@mail.pt" }, lines: [{ sku: "TN-1", quantity: 3 }, { sku: "SRV", quantity: 1 }] });
      expect(order.status).toBe("CONFIRMED");
      const lines = await prisma().salesOrderLine.findMany({ where: { orderId: order.id }, orderBy: { position: "asc" } });
      expect(lines.map((l) => Number(l.reservedQuantity))).toEqual([2, 0]);
      expect(Number((await prisma().product.findUniqueOrThrow({ where: { id: toner.id } })).reserved)).toBe(2);
      expect(Number((await prisma().product.findUniqueOrThrow({ where: { id: servico.id } })).reserved)).toBe(0);
      // Na API de produtos, o disponível já desconta a reserva.
      const p = await api().get(`/api/v1/products/${toner.id}`).set(bearer()).expect(200);
      expect(p.body.data).toMatchObject({ stock_on_hand: 2, reserved: 2, available: 0 });
      const n = await notes("ORDER", order.id);
      expect(n).toContain("Encomenda confirmada");
      expect(n.some((x) => x?.startsWith("A aguardar stock: 1 × Toner preto"))).toBe(true);
      // Na interface, a encomenda aparece «a aguardar stock».
      const waiting = (await api().get("/orders").query({ waiting: "true" }).set("Authorization", admin).expect(200)).body.items;
      expect(waiting.map((o: { id: string }) => o.id)).toEqual([order.id]);

      const deliveries = async () => {
        for (let i = 0; i < 80; i++) {
          const rows = await prisma().webhookDelivery.findMany({ where: { subscriptionId: sub.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
          if (rows.length >= 2) return rows;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("faltam entregas");
      };
      const events = (await deliveries()).map((r) => r.payload as unknown as { type: string; data: Record<string, unknown> });
      expect(events.map((e) => [e.type, e.data.status, e.data.from ?? null, e.data.to ?? null]).sort()).toEqual(
        [
          ["order.created", "DRAFT", null, null],
          ["order.status_changed", "CONFIRMED", "DRAFT", "CONFIRMED"],
        ].sort(),
      );
      expect(events[0].data).toMatchObject({ order_id: order.id, customer_reference: "2002" });

      // As primeiras tentativas (para um endereço que recusa) acabam antes do teste seguinte limpar a base.
      for (let i = 0; i < 100; i++) {
        const busy = await prisma().webhookDelivery.count({ where: { subscriptionId: sub.id, OR: [{ attempts: 0 }, { lockedUntil: { not: null } }] } });
        if (busy === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
    });

    it("linhas que não se podem cumprir: 422 com o índice, nada fica criado, e o id externo fica livre", async () => {
      await newProduct({ sku: "TN-1" });
      const off = await newProduct({ sku: "OLD" });
      await api().patch(`/products/${off.id}`).set("Authorization", admin).send({ active: false }).expect(200);
      await newProduct({ sku: "SEM-PRECO", salePrice: null });
      const before = await counts();
      const customer = { tax_id: "509999990", company_name: "Nova Lda", email: "novo@nova.pt" };

      const unknown = await postOrder({ external_id: "3003", customer, lines: [{ sku: "TN-1", quantity: 1 }, { sku: "NAO-EXISTE", quantity: 1 }] });
      expectConforms(unknown, "POST", "/api/v1/orders");
      expect(unknown.status).toBe(422);
      expect(unknown.body.error).toMatchObject({ code: "unprocessable", message: "Linha 2: não há nenhum produto com a referência «NAO-EXISTE»", details: { line_index: 1, sku: "NAO-EXISTE", reason: "unknown_sku" } });
      const inactive = await postOrder({ customer, lines: [{ sku: "old", quantity: 1 }] }).expect(422);
      expect(inactive.body.error.details).toMatchObject({ line_index: 0, reason: "inactive_product" });
      const noPrice = await postOrder({ customer, lines: [{ sku: "SEM-PRECO", quantity: 1 }] }).expect(422);
      expect(noPrice.body.error.details).toMatchObject({ reason: "missing_price" });
      // Nem empresa, nem contacto, nem encomenda, nem ligação.
      expect(await counts()).toEqual(before);

      // Mal formadas: 400.
      const free = await postOrder({ customer, lines: [{ description: "Portes", quantity: 1, unit_price: 5 }] });
      expectConforms(free, "POST", "/api/v1/orders");
      expect(free.status).toBe(400);
      expect(JSON.stringify(free.body.error.details)).toContain("vat_rate");
      await postOrder({ customer, lines: [] }).expect(400);
      await postOrder({ lines: [{ sku: "TN-1", quantity: 1 }] }).expect(400);
      await postOrder({ customer, lines: [{ sku: "TN-1", quantity: 0 }] }).expect(400);
      await postOrder({ customer, lines: [{ sku: "TN-1", quantity: 1.234 }] }).expect(400);
      const noCustomer = await postOrder({ customer: { tax_id: "999999990" }, lines: [{ sku: "TN-1", quantity: 1 }] }).expect(422);
      expect(noCustomer.body.error.details).toEqual({ field: "customer" });
      const empty = await postOrder({ customer: {}, lines: [{ sku: "TN-1", quantity: 1 }] }).expect(422);
      expect(empty.body.error).toMatchObject({ code: "unprocessable", message: "Indica o cliente: NIF, email ou nome", details: { field: "customer" } });
      expect(await counts()).toEqual(before);

      // Corrigida, a mesma encomenda (mesmo external_id) cria-se.
      const ok = await created({ external_id: "3003", customer, lines: [{ sku: "TN-1", quantity: 1 }] });
      expect(ok.external_id).toBe("3003");
    });

    it("external_id repetido → 409 com a encomenda existente; idempotência; outra chave não colide", async () => {
      await newProduct({ sku: "TN-1" });
      const body = { external_id: "4004", customer: { name: "Ana", email: "ana@mail.pt" }, lines: [{ sku: "TN-1", quantity: 1 }] };
      const idemKey = nextIdem();
      const first = await postOrder(body, idemKey).expect(201);

      // Mesma Idempotency-Key e mesmo corpo: a mesma resposta, sem criar outra.
      const replay = await postOrder(body, idemKey).expect(201);
      expect(replay.headers["idempotent-replayed"]).toBe("true");
      expect(replay.body).toEqual(first.body);
      // Mesma chave com outro corpo: 422.
      const reuse = await postOrder({ ...body, notes: "outro" }, idemKey);
      expectConforms(reuse, "POST", "/api/v1/orders");
      expect(reuse.status).toBe(422);
      expect(reuse.body.error.code).toBe("idempotency_key_reuse");
      // Outra Idempotency-Key com o mesmo external_id: 409 com o id.
      const dup = await postOrder(body);
      expectConforms(dup, "POST", "/api/v1/orders");
      expect(dup.status).toBe(409);
      expect(dup.body.error).toMatchObject({ code: "conflict", details: { existing_id: first.body.data.id } });
      expect(await prisma().salesOrder.count()).toBe(1);
      // Sem Idempotency-Key: 400.
      await api().post("/api/v1/orders").set(bearer()).send(body).expect(400);

      // Outra chave (outra integração) pode usar o mesmo número.
      const other = await newKey(["orders:write", "orders:read"], "Marketplace");
      const second = await postOrder(body, nextIdem(), other).expect(201);
      expect(second.body.data.external_id).toBe("4004");
      expect(await prisma().salesOrder.count()).toBe(2);
      // Cada chave vê o seu id externo.
      expect((await api().get(`/api/v1/orders/${first.body.data.id}`).set(bearer(other)).expect(200)).body.data.external_id).toBeNull();

      // Âmbito: ler não chega para criar, e criar não chega para ler.
      const readOnly = await newKey(["orders:read"], "Só leitura");
      expectConforms(await postOrder(body, nextIdem(), readOnly).expect(403), "POST", "/api/v1/orders");
      const writeOnly = await newKey(["orders:write"], "Só escrita");
      expectConforms(await api().get("/api/v1/orders").set(bearer(writeOnly)).expect(403), "GET", "/api/v1/orders");

      // Apagado o rascunho no CRM, o id externo fica livre: a loja pode voltar a enviá-la.
      await api().delete(`/orders/${first.body.data.id}`).set("Authorization", admin).expect(204);
      const again = await postOrder(body).expect(201);
      expect(again.body.data.id).not.toBe(first.body.data.id);
    });

    it("sem o módulo «Encomendas»: 404 nas rotas de encomendas", async () => {
      await setModule("compras", false);
      await setModule("encomendas", false);
      const res = await postOrder({ customer: { name: "Ana" }, lines: [{ description: "x", quantity: 1, unit_price: 1, vat_rate: 23 }] });
      expectConforms(res, "POST", "/api/v1/orders");
      expect(res.status).toBe(404);
      expectConforms(await api().get("/api/v1/orders").set(bearer()).expect(404), "GET", "/api/v1/orders");
      await api().get("/api/v1/orders/x").set(bearer()).expect(404);
      // Os produtos continuam.
      await api().get("/api/v1/products").set(bearer()).expect(200);
    });
  });

  describe("ler encomendas", () => {
    it("estado, expedições com link e sem custo, filtro external_id, sincronização (também com envio parcial)", async () => {
      const toner = await newProduct({ sku: "TN-1" });
      await move(toner.id, "INITIAL", 10);
      const ctt = (await api().post("/carriers").set("Authorization", admin).send({ name: "CTT", trackingUrlTemplate: "https://seguir.exemplo.pt/?n={codigo}" }).expect(201)).body;
      const a = await created({ confirm: true, external_id: "5001", customer: { name: "Ana", email: "ana@mail.pt" }, lines: [{ sku: "TN-1", quantity: 3 }] });
      await new Promise((r) => setTimeout(r, 5));
      const b = await created({ external_id: "5002", customer: { name: "Ana", email: "ana@mail.pt" }, lines: [{ sku: "TN-1", quantity: 1 }] });
      // Uma encomenda feita na interface também se lê (sem external_id).
      const companyId = (await api().post("/companies").set("Authorization", admin).send({ name: "Balcão" }).expect(201)).body.id;
      await new Promise((r) => setTimeout(r, 5));
      const ui = (await api().post("/orders").set("Authorization", admin).send({ companyId }).expect(201)).body;

      const list = await api().get("/api/v1/orders").set(bearer());
      expectConforms(list, "GET", "/api/v1/orders");
      expect(list.body.data.map((o: PublicOrder) => [o.id, o.external_id])).toEqual([
        [a.id, "5001"],
        [b.id, "5002"],
        [ui.id, null],
      ]);
      const filtered = await api().get("/api/v1/orders").query({ external_id: "5002" }).set(bearer()).expect(200);
      expect(filtered.body.data.map((o: PublicOrder) => o.id)).toEqual([b.id]);
      expect((await api().get("/api/v1/orders").query({ external_id: "nao" }).set(bearer()).expect(200)).body).toEqual({ data: [], next_cursor: null });
      const page1 = await api().get("/api/v1/orders").query({ limit: 2 }).set(bearer()).expect(200);
      const page2 = await api().get("/api/v1/orders").query({ limit: 2, cursor: page1.body.next_cursor }).set(bearer()).expect(200);
      expect([...page1.body.data, ...page2.body.data].map((o: PublicOrder) => o.id)).toEqual([a.id, b.id, ui.id]);
      expect(page2.body.next_cursor).toBeNull();

      // Envio parcial na interface (com custo): a encomenda muda de data e aparece na sincronização.
      const since = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 5));
      await api()
        .post(`/orders/${a.id}/ship`)
        .set("Authorization", admin)
        .send({ lines: [{ lineId: a.lines[0].id, quantity: 1 }], carrierId: ctt.id, trackingCode: "RR1 PT", packages: 1, weightKg: 1.5, cost: 7.9, notes: "nota interna" })
        .expect(200);
      const changed = await api().get("/api/v1/orders").query({ updated_since: since }).set(bearer()).expect(200);
      expect(changed.body.data.map((o: PublicOrder) => o.id)).toEqual([a.id]);

      const one = await api().get(`/api/v1/orders/${a.id}`).set(bearer());
      expectConforms(one, "GET", "/api/v1/orders/{id}");
      expect(one.body.data).toMatchObject({
        status: "CONFIRMED",
        partially_shipped: true,
        lines: [{ sku: "TN-1", quantity: 3, shipped_quantity: 1 }],
        shipments: [{ carrier: "CTT", tracking_code: "RR1 PT", tracking_url: "https://seguir.exemplo.pt/?n=RR1%20PT", packages: 1, weight_kg: 1.5, lines: [{ order_line_id: a.lines[0].id, sku: "TN-1", quantity: 1 }] }],
      });
      // Sem o custo da expedição nem as notas internas.
      // (Pelos nomes dos campos: um valor como «7.9» pode aparecer por acaso numa data.)
      expect(Object.keys(one.body.data)).not.toContain("notes");
      expect(Object.keys(one.body.data.shipments[0])).not.toContain("cost");
      expect(Object.keys(one.body.data.shipments[0])).not.toContain("notes");
      expect(JSON.stringify(one.body)).not.toMatch(/"cost"|nota interna/);

      // Correção da expedição também conta como alteração.
      const shipmentId = one.body.data.shipments[0].id;
      const since2 = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 5));
      await api().patch(`/orders/${a.id}/shipments/${shipmentId}`).set("Authorization", admin).send({ trackingCode: "RR2PT" }).expect(200);
      expect((await api().get("/api/v1/orders").query({ updated_since: since2 }).set(bearer()).expect(200)).body.data.map((o: PublicOrder) => o.id)).toEqual([a.id]);

      // Enviado o resto: enviada, já não «parcialmente».
      await api().post(`/orders/${a.id}/ship`).set("Authorization", admin).send({}).expect(200);
      expect((await api().get(`/api/v1/orders/${a.id}`).set(bearer()).expect(200)).body.data).toMatchObject({ status: "SHIPPED", partially_shipped: false, lines: [{ shipped_quantity: 3 }] });

      expectConforms(await api().get("/api/v1/orders/nao-existe").set(bearer()).expect(404), "GET", "/api/v1/orders/{id}");
    });
  });

  describe("concorrência", () => {
    it("o mesmo external_id em dois pedidos ao mesmo tempo cria uma só encomenda; o mesmo cliente novo, uma só empresa", async () => {
      await newProduct({ sku: "TN-1" });
      const body = { external_id: "6006", customer: { tax_id: "509999990", company_name: "Nova Lda", email: "novo@nova.pt", name: "Novo" }, lines: [{ sku: "TN-1", quantity: 1 }] };
      const results = await Promise.all([1, 2, 3].map(() => postOrder(body)));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const id = results.find((r) => r.status === 201)!.body.data.id;
      for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.details).toEqual({ existing_id: id });
      expect(await prisma().salesOrder.count()).toBe(1);

      // Ids externos diferentes, o mesmo cliente novo: uma só empresa e um só contacto.
      const many = await Promise.all(["6101", "6102", "6103"].map((ext) => postOrder({ ...body, external_id: ext, customer: { ...body.customer, tax_id: "508888880", email: "outro@nova.pt" } })));
      expect(many.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(new Set(many.map((r) => r.body.data.customer.company_id)).size).toBe(1);
      expect(new Set(many.map((r) => r.body.data.customer.contact_id)).size).toBe(1);
      expect(await prisma().company.count({ where: { taxId: "508888880" } })).toBe(1);
      expect(await prisma().contact.count({ where: { email: "outro@nova.pt" } })).toBe(1);

      // Só o NIF em comum (emails diferentes): uma só empresa.
      const byTax = await Promise.all([1, 2, 3].map((i) => postOrder({ customer: { tax_id: "507777770", company_name: "Sete Lda", email: `p${i}@sete.pt` }, lines: [{ sku: "TN-1", quantity: 1 }] })));
      expect(byTax.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(await prisma().company.count({ where: { taxId: "507777770" } })).toBe(1);
      // Só o email em comum (sem NIF): um só contacto.
      const byEmail = await Promise.all([1, 2, 3].map(() => postOrder({ customer: { name: "Rui", email: "rui@mail.pt" }, lines: [{ sku: "TN-1", quantity: 1 }] })));
      expect(byEmail.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(await prisma().contact.count({ where: { email: "rui@mail.pt" } })).toBe(1);
    });
  });
});
