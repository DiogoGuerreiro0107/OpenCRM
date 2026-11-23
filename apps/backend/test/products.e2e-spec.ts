import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { Role } from "@prisma/client";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";

// Fase 5a (docs/plano-fase-5-produtos-stock.md): catálogo de produtos, categorias e fornecedores.
describe("Catálogo de produtos (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  const as = async (role: Role) => bearerFor(app, await createUser(prisma(), role));

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    admin = await as("ADMINISTRADOR");
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (body: Record<string, unknown>, auth = admin) => api().post("/products").set("Authorization", auth).send(body);
  const newProduct = async (body: Record<string, unknown> = {}) =>
    (await create({ sku: `REF-${Math.random().toString(36).slice(2, 8)}`, name: "Produto", ...body }).expect(201)).body as { id: string; sku: string };
  const list = async (query: Record<string, string>, auth = admin) => (await api().get("/products").query(query).set("Authorization", auth).expect(200)).body;
  const names = (body: { items: Array<{ name: string }> }) => body.items.map((p) => p.name);

  it("criar: referência normalizada e única, código de barras único, predefinições e validações", async () => {
    const p = (await create({ sku: "  tn-2420 ", barcode: " 5600000000017 ", name: " Toner Brother TN-2420 ", salePrice: 45.9 }).expect(201)).body;
    expect(p).toMatchObject({ sku: "TN-2420", barcode: "5600000000017", name: "Toner Brother TN-2420", unit: "UN", vatRate: 23, salePrice: 45.9, salePriceWithVat: 56.46, active: true, tracksStock: true, category: null, suppliers: [], minStock: null });
    expect(p.searchText).toBeUndefined();

    expect((await create({ sku: "TN-2420", name: "Outro" }).expect(409)).body.message).toMatch(/referência/);
    expect((await create({ sku: "tn-2420", name: "Outro" }).expect(409)).body.message).toMatch(/referência/);
    expect((await create({ sku: "X-1", barcode: "5600000000017", name: "Outro" }).expect(409)).body.message).toMatch(/código de barras/);

    const service = (await create({ sku: "SRV-1", name: "Hora de assistência", unit: "H", vatRate: 23, tracksStock: false }).expect(201)).body;
    expect(service).toMatchObject({ unit: "H", tracksStock: false, salePrice: null, salePriceWithVat: null });

    for (const bad of [{ sku: " ", name: "x" }, { sku: "A", name: " " }, { sku: "A", name: "x", salePrice: -1 }, { sku: "A", name: "x", salePrice: 1.234 }, { sku: "A", name: "x", vatRate: 101 }, { sku: "A", name: "x", unit: "TON" }, { sku: "A", name: "x", minStock: -2 }]) {
      await create(bad).expect(400);
    }
    // A base de dados também recusa valores inválidos.
    await expect(prisma().product.create({ data: { sku: "DB-1", name: "x", vatRate: 150 } })).rejects.toThrow();
  });

  it("editar e apagar: `null` limpa; a referência continua única", async () => {
    const a = await newProduct({ sku: "A-1", barcode: "111", description: "Descrição", salePrice: 10 });
    await newProduct({ sku: "B-1" });
    await api().patch(`/products/${a.id}`).set("Authorization", admin).send({ sku: "b-1" }).expect(409);
    const edited = (await api().patch(`/products/${a.id}`).set("Authorization", admin).send({ barcode: null, description: null, salePrice: null, vatRate: 6, name: "Novo nome" }).expect(200)).body;
    expect(edited).toMatchObject({ sku: "A-1", barcode: null, description: null, salePrice: null, vatRate: 6, name: "Novo nome" });
    await api().delete(`/products/${a.id}`).set("Authorization", admin).expect(204);
    await api().delete(`/products/${a.id}`).set("Authorization", admin).expect(404);
    await api().get(`/products/${a.id}`).set("Authorization", admin).expect(404);
  });

  it("lista: pesquisa sem acentos (também pela referência do fornecedor), filtros e paginação", async () => {
    const supplier = await prisma().company.create({ data: { name: "Distribuidora Lda" } });
    const cat = (await api().post("/product-categories").set("Authorization", admin).send({ name: "Consumíveis" }).expect(201)).body;
    const a = await newProduct({ sku: "TIN-1", name: "Tinteiro Preto", categoryId: cat.id });
    await newProduct({ sku: "PAP-1", name: "Papel A4", description: "Resma de 500 folhas" });
    await newProduct({ sku: "SRV-1", name: "Instalação", tracksStock: false });
    await newProduct({ sku: "OLD-1", name: "Tinteiro Azul (antigo)", active: false });
    await api().post(`/products/${a.id}/suppliers`).set("Authorization", admin).send({ companyId: supplier.id, supplierSku: "DIST-998877" }).expect(201);

    expect(names(await list({}))).toEqual(["Instalação", "Papel A4", "Tinteiro Preto"]);
    expect(names(await list({ active: "all" }))).toEqual(["Instalação", "Papel A4", "Tinteiro Azul (antigo)", "Tinteiro Preto"]);
    expect(names(await list({ active: "false" }))).toEqual(["Tinteiro Azul (antigo)"]);
    expect(names(await list({ search: "tinteiro", active: "all" }))).toEqual(["Tinteiro Azul (antigo)", "Tinteiro Preto"]);
    expect(names(await list({ search: "consumiveis" }))).toEqual([]);
    expect(names(await list({ search: "resma" }))).toEqual(["Papel A4"]);
    expect(names(await list({ search: "pap-1" }))).toEqual(["Papel A4"]);
    expect(names(await list({ search: "998877" }))).toEqual(["Tinteiro Preto"]);
    expect(names(await list({ categoryId: cat.id }))).toEqual(["Tinteiro Preto"]);
    expect(names(await list({ tracksStock: "false" }))).toEqual(["Instalação"]);
    expect(names(await list({ supplierId: supplier.id }))).toEqual(["Tinteiro Preto"]);

    const first = await list({ limit: "2" });
    expect(names(first)).toEqual(["Instalação", "Papel A4"]);
    const second = await list({ limit: "2", cursor: first.nextCursor });
    expect(names(second)).toEqual(["Tinteiro Preto"]);
    expect(second.nextCursor).toBeNull();
  });

  it("categorias: nome único sem maiúsculas, desativada não se escolhe, em uso não se apaga", async () => {
    const cat = (await api().post("/product-categories").set("Authorization", admin).send({ name: "Toners", sortOrder: 2 }).expect(201)).body;
    await api().post("/product-categories").set("Authorization", admin).send({ name: " toners " }).expect(409);
    const other = (await api().post("/product-categories").set("Authorization", admin).send({ name: "Papel", sortOrder: 1 }).expect(201)).body;
    await newProduct({ categoryId: cat.id });
    await create({ sku: "Z", name: "x", categoryId: "nao-existe" }).expect(400);

    const categories = (await api().get("/product-categories").set("Authorization", admin).expect(200)).body;
    expect(categories.map((c: { name: string; productCount: number }) => [c.name, c.productCount])).toEqual([["Papel", 0], ["Toners", 1]]);

    await api().delete(`/product-categories/${cat.id}`).set("Authorization", admin).expect(409);
    await api().patch(`/product-categories/${cat.id}`).set("Authorization", admin).send({ active: false }).expect(200);
    await create({ sku: "Y", name: "x", categoryId: cat.id }).expect(400);
    await api().patch(`/product-categories/${other.id}`).set("Authorization", admin).send({ name: "TONERS" }).expect(409);
    await api().delete(`/product-categories/${other.id}`).set("Authorization", admin).expect(204);
  });

  it("fornecedores: ligar marca a empresa; o primeiro é o preferido; um só preferido; custo e margem; filtro de fornecedores", async () => {
    const p = await newProduct({ salePrice: 100 });
    const [s1, s2] = await Promise.all([prisma().company.create({ data: { name: "Fornecedor 1" } }), prisma().company.create({ data: { name: "Fornecedor 2" } })]);
    const add = (body: Record<string, unknown>) => api().post(`/products/${p.id}/suppliers`).set("Authorization", admin).send(body);

    let view = (await add({ companyId: s1.id, supplierSku: "F1-ABC", costPrice: 60 }).expect(201)).body;
    expect(view.suppliers).toEqual([{ id: expect.any(String), company: { id: s1.id, name: "Fornecedor 1" }, supplierSku: "F1-ABC", preferred: true, costPrice: 60 }]);
    expect(view).toMatchObject({ preferredSupplier: { id: s1.id }, margin: 40 });
    expect((await prisma().company.findUniqueOrThrow({ where: { id: s1.id } })).isSupplier).toBe(true);
    await add({ companyId: s1.id }).expect(409);
    await add({ companyId: "nao-existe" }).expect(404);

    view = (await add({ companyId: s2.id, costPrice: 70.1234, preferred: true }).expect(201)).body;
    expect(view.suppliers.map((s: { preferred: boolean }) => s.preferred)).toEqual([false, true]);
    expect(view.margin).toBe(29.9);

    const link1 = view.suppliers[0].id;
    view = (await api().patch(`/products/${p.id}/suppliers/${link1}`).set("Authorization", admin).send({ preferred: true, costPrice: 55 }).expect(200)).body;
    expect(view.suppliers.map((s: { preferred: boolean; costPrice: number }) => [s.preferred, s.costPrice])).toEqual([[true, 55], [false, 70.1234]]);
    await api().patch(`/products/${p.id}/suppliers/nao-existe`).set("Authorization", admin).send({ costPrice: 1 }).expect(404);
    await add({ companyId: (await prisma().company.create({ data: { name: "F3" } })).id, costPrice: -1 }).expect(400);

    // A base de dados não deixa dois preferidos no mesmo produto.
    await expect(prisma().productSupplier.updateMany({ where: { productId: p.id }, data: { preferredFor: p.id } })).rejects.toThrow();

    const companies = (await api().get("/companies").query({ supplier: "true" }).set("Authorization", admin).expect(200)).body;
    expect(companies.items.map((c: { name: string }) => c.name).sort()).toEqual(["Fornecedor 1", "Fornecedor 2"]);

    await api().delete(`/products/${p.id}/suppliers/${link1}`).set("Authorization", admin).expect(204);
    view = (await api().get(`/products/${p.id}`).set("Authorization", admin).expect(200)).body;
    expect(view).toMatchObject({ preferredSupplier: null, margin: null });
    // Apagar a empresa tira-a dos produtos.
    await prisma().company.delete({ where: { id: s2.id } });
    expect((await api().get(`/products/${p.id}`).set("Authorization", admin).expect(200)).body.suppliers).toEqual([]);
  });

  it("permissões: a área «Catálogo de produtos»; custos e margem só para quem a tem", async () => {
    const p = await newProduct({ salePrice: 100 });
    const supplier = await prisma().company.create({ data: { name: "Fornecedor" } });
    await api().post(`/products/${p.id}/suppliers`).set("Authorization", admin).send({ companyId: supplier.id, costPrice: 60 }).expect(201);

    const tecnico = await as("TECNICO");
    const comercial = await as("COMERCIAL");
    const financeiro = await as("FINANCEIRO");
    const reader = await as("LEITURA_APENAS");
    for (const auth of [tecnico, comercial, reader]) {
      await create({ sku: "NOPE", name: "x" }, auth).expect(403);
      const seen = (await api().get(`/products/${p.id}`).set("Authorization", auth).expect(200)).body;
      expect(seen.suppliers[0].costPrice).toBeUndefined();
      expect(seen.margin).toBeUndefined();
      expect((await list({}, auth)).items[0].suppliers[0].costPrice).toBeUndefined();
    }
    await create({ sku: "FIN-1", name: "x" }, financeiro).expect(201);
    expect((await api().get(`/products/${p.id}`).set("Authorization", financeiro).expect(200)).body.suppliers[0].costPrice).toBe(60);

    // A área é configurável: dar o catálogo aos comerciais mostra-lhes os custos.
    await api().patch("/permissions/catalog").set("Authorization", admin).send({ roles: ["ADMINISTRADOR", "COMERCIAL"] }).expect(200);
    expect((await api().get(`/products/${p.id}`).set("Authorization", comercial).expect(200)).body.suppliers[0].costPrice).toBe(60);
    await create({ sku: "FIN-2", name: "x" }, financeiro).expect(403);
  });

  it("auditoria dos preços e custos", async () => {
    const p = await newProduct({ sku: "AUD-1", salePrice: 10 });
    await api().patch(`/products/${p.id}`).set("Authorization", admin).send({ salePrice: 12.5, description: "não vai à auditoria" }).expect(200);
    const supplier = await prisma().company.create({ data: { name: "Fornecedor" } });
    const view = (await api().post(`/products/${p.id}/suppliers`).set("Authorization", admin).send({ companyId: supplier.id, costPrice: 7 }).expect(201)).body;
    await api().patch(`/products/${p.id}/suppliers/${view.suppliers[0].id}`).set("Authorization", admin).send({ costPrice: 8 }).expect(200);

    const events = await prisma().auditEvent.findMany({ where: { targetId: p.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => [e.action, e.metadata])).toEqual([
      ["product.created", expect.objectContaining({ sku: "AUD-1", salePrice: 10 })],
      ["product.updated", { salePrice: 12.5 }],
      ["product.supplier_added", expect.objectContaining({ companyId: supplier.id, costPrice: 7 })],
      ["product.supplier_updated", { costPrice: 8 }],
    ]);
  });

  it("campos personalizados do produto e módulo desligado", async () => {
    const p = await newProduct();
    const field = (await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "PRODUCT", fieldLabel: "Cor", fieldType: "TEXT" }).expect(201)).body;
    await api().post("/custom-fields/values").set("Authorization", admin).send({ entityType: "PRODUCT", entityId: p.id, values: [{ customFieldId: field.id, value: "Preto" }] }).expect(201);
    await api().post("/custom-fields/values").set("Authorization", await as("TECNICO")).send({ entityType: "PRODUCT", entityId: p.id, values: [{ customFieldId: field.id, value: "x" }] }).expect(403);

    // O stock depende dos produtos (Fase 5b): sem o desligar primeiro, os produtos não se desligam.
    await api().patch("/modules/produtos").set("Authorization", admin).send({ enabled: false }).expect(400);
    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().patch("/modules/produtos").set("Authorization", admin).send({ enabled: false }).expect(200);
    await api().get("/products").set("Authorization", admin).expect(404);
    await api().get("/product-categories").set("Authorization", admin).expect(404);
    await api().get("/custom-fields/values").query({ entityType: "PRODUCT", entityId: p.id }).set("Authorization", admin).expect(404);
    await api().patch("/modules/produtos").set("Authorization", admin).send({ enabled: true }).expect(200);
    await api().patch("/modules/stock").set("Authorization", admin).send({ enabled: true }).expect(200);
    await api().get(`/products/${p.id}`).set("Authorization", admin).expect(200);
  });
});
