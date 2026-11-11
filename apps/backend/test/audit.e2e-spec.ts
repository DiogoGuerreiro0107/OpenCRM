import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase, TEST_PASSWORD } from "./helpers";
import { EmailService } from "../src/email/email.service";

// Registo de auditoria (pacote E0b, docs/plano-e0-api-publica.md). Instância própria: usa os endpoints de
// recuperação de password, que têm um limite estrito por minuto.
describe("Registo de auditoria (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const setup = async () => {
    const admin = await createUser(prisma(), "ADMINISTRADOR", "Ana Admin");
    return { admin, auth: await bearerFor(app, admin) };
  };
  const events = (action?: string) =>
    prisma().auditEvent.findMany({ where: action ? { action } : undefined, orderBy: { createdAt: "asc" } });
  const allAsText = async () => JSON.stringify(await prisma().auditEvent.findMany());

  describe("ações de administração são registadas", () => {
    it("criar e alterar utilizadores: quem, o quê, a quem — sem passwords", async () => {
      const { admin, auth } = await setup();
      const created = await api()
        .post("/users")
        .set("Authorization", auth)
        .send({ name: "Nova", email: "nova@e2e.test", role: "COMERCIAL", password: "password-inicial-1" })
        .expect(201);

      const [createdEvent] = await events("user.created");
      expect(createdEvent).toMatchObject({
        actorId: admin.id,
        actorName: "Ana Admin",
        targetType: "user",
        targetId: created.body.id,
        metadata: { name: "Nova", email: "nova@e2e.test", role: "COMERCIAL" },
      });
      expect(createdEvent.ip).toBeTruthy();

      await api().patch(`/users/${created.body.id}`).set("Authorization", auth).send({ role: "TECNICO", active: false }).expect(200);
      expect((await events("user.updated"))[0]).toMatchObject({ targetId: created.body.id, metadata: { role: "TECNICO", active: false } });

      await api().post(`/users/${created.body.id}/password`).set("Authorization", auth).send({ newPassword: "definida-pelo-admin" }).expect(204);
      expect((await events("user.password_set_by_admin"))[0]).toMatchObject({ targetId: created.body.id, metadata: null });

      const text = await allAsText();
      expect(text).not.toContain("password-inicial-1");
      expect(text).not.toContain("definida-pelo-admin");
    });

    it("módulos: ligar e desligar", async () => {
      const { admin, auth } = await setup();
      await api().patch("/modules/leads").set("Authorization", auth).send({ enabled: false }).expect(200);
      expect((await events("module.toggled"))[0]).toMatchObject({ actorId: admin.id, targetType: "module", targetId: "leads", metadata: { enabled: false } });
    });

    it("conta Zadarma: regista que as credenciais mudaram, nunca os valores", async () => {
      const { auth } = await setup();
      await api()
        .post("/zadarma/account")
        .set("Authorization", auth)
        .send({ apiKey: "chave-publica-xyz", apiSecret: "segredo-zadarma-xyz", callerExtension: "100", active: true })
        .expect(201);
      const [event] = await events("zadarma.account_saved");
      expect(event.metadata).toEqual({ callerExtension: "100", active: true, credenciais: "alteradas" });
      const text = await allAsText();
      expect(text).not.toContain("segredo-zadarma-xyz");
      expect(text).not.toContain("chave-publica-xyz");
    });

    it("funis e campos personalizados", async () => {
      const { auth } = await setup();
      const pipeline = await api().post("/pipelines").set("Authorization", auth).send({ name: "Funil teste" }).expect(201);
      await api().delete(`/pipelines/${pipeline.body.id}`).set("Authorization", auth).expect(204);
      const field = await api()
        .post("/custom-fields")
        .set("Authorization", auth)
        .send({ entityType: "COMPANY", fieldLabel: "NIF alternativo", fieldType: "TEXT" })
        .expect(201);

      expect((await events("pipeline.created"))[0]).toMatchObject({ targetId: pipeline.body.id, metadata: { name: "Funil teste" } });
      expect(await events("pipeline.deleted")).toHaveLength(1);
      expect((await events("custom_field.created"))[0]).toMatchObject({ targetId: field.body.id, metadata: { fieldLabel: "NIF alternativo" } });
    });
  });

  describe("o que NÃO é registado", () => {
    it("pedidos recusados (permissões, validação, inexistente) e leituras", async () => {
      const { auth } = await setup();
      const comercial = await bearerFor(app, await createUser(prisma(), "COMERCIAL"));

      await api().post("/users").set("Authorization", comercial).send({ name: "x", email: "x@e2e.test", role: "COMERCIAL", password: "12345678" }).expect(403);
      await api().post("/users").set("Authorization", auth).send({ name: "x" }).expect(400);
      await api().patch("/modules/inexistente").set("Authorization", auth).send({ enabled: false }).expect(404);
      await api().get("/users/manage").set("Authorization", auth).expect(200);

      expect(await events()).toHaveLength(0);
    });

    it("trabalho do dia-a-dia (tarefas, empresas) não entra no registo", async () => {
      const auth = await bearerFor(app, await createUser(prisma(), "COMERCIAL"));
      await api().post("/companies").set("Authorization", auth).send({ name: "Empresa E2E", tradeName: "Empresa E2E" }).expect((res) => {
        if (res.status >= 500) throw new Error(`erro ${res.status}`);
      });
      expect(await events()).toHaveLength(0);
    });
  });

  describe("eventos de autenticação", () => {
    it("alterar a própria password e recuperar a password", async () => {
      const user = await createUser(prisma(), "COMERCIAL", "Carlos");
      await api()
        .post("/auth/change-password")
        .set("Authorization", await bearerFor(app, user))
        .send({ currentPassword: TEST_PASSWORD, newPassword: "Nova-password-1" })
        .expect(200);
      expect((await events("auth.password_changed"))[0]).toMatchObject({ actorId: user.id, actorName: "Carlos", targetId: user.id });

      let emailText = "";
      jest.spyOn(app.get(EmailService), "sendRaw").mockImplementation(async (_to, _subject, text) => {
        emailText = text;
      });
      await api().post("/auth/forgot-password").send({ email: user.email }).expect(200);
      expect((await events("auth.password_reset_requested"))[0]).toMatchObject({ actorId: null, targetId: user.id });

      const token = emailText.match(/token=([0-9a-f]{64})/)?.[1];
      await api().post("/auth/reset-password").send({ token, newPassword: "Outra-password-2" }).expect(200);
      expect((await events("auth.password_reset"))[0]).toMatchObject({ actorId: user.id, targetId: user.id });

      const text = await allAsText();
      expect(text).not.toContain(token!);
      expect(text).not.toContain("Nova-password-1");
      expect(text).not.toContain("Outra-password-2");
    });

    it("pedir recuperação para email inexistente ou desativado não regista nada", async () => {
      const user = await createUser(prisma(), "COMERCIAL");
      await prisma().user.update({ where: { id: user.id }, data: { active: false } });
      await api().post("/auth/forgot-password").send({ email: user.email }).expect(200);
      await api().post("/auth/forgot-password").send({ email: "ninguem@e2e.test" }).expect(200);
      expect(await events()).toHaveLength(0);
    });
  });

  describe("só de acrescentar (trigger na base de dados)", () => {
    it("UPDATE e DELETE são recusados, mesmo por SQL direto", async () => {
      const { auth } = await setup();
      await api().patch("/modules/leads").set("Authorization", auth).send({ enabled: false }).expect(200);
      const [event] = await events();

      await expect(prisma().auditEvent.update({ where: { id: event.id }, data: { action: "adulterado" } })).rejects.toThrow(/só de acrescentar/);
      await expect(prisma().auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/só de acrescentar/);
      await expect(prisma().auditEvent.deleteMany()).rejects.toThrow(/só de acrescentar/);
      await expect(prisma().$executeRawUnsafe(`UPDATE "AuditEvent" SET "actorName" = 'x'`)).rejects.toThrow(/só de acrescentar/);

      expect(await events()).toHaveLength(1);
      expect((await events())[0].action).toBe("module.toggled");
    });

    it("o utilizador que aparece no registo não pode ser apagado (fica o rasto)", async () => {
      const { admin, auth } = await setup();
      await api().patch("/modules/leads").set("Authorization", auth).send({ enabled: false }).expect(200);
      await expect(prisma().user.delete({ where: { id: admin.id } })).rejects.toThrow();
    });
  });

  describe("falha a registar não derruba a ação", () => {
    it("a ação conclui-se e o erro fica no registo da aplicação", async () => {
      const { auth } = await setup();
      jest.spyOn(prisma().auditEvent, "create").mockRejectedValue(new Error("base de dados indisponível"));
      await api().patch("/modules/leads").set("Authorization", auth).send({ enabled: false }).expect(200);
      expect(await events()).toHaveLength(0);
      const setting = await prisma().moduleSetting.findUnique({ where: { moduleId: "leads" } });
      expect(setting?.enabled).toBe(false);
    });
  });

  describe("GET /audit", () => {
    it("só o Administrador lê; sem sessão dá 401", async () => {
      await setup();
      await api().get("/audit").expect(401);
      for (const role of ["COMERCIAL", "TECNICO", "BACKOFFICE", "FINANCEIRO", "LEITURA_APENAS"] as const) {
        await api().get("/audit").set("Authorization", await bearerFor(app, await createUser(prisma(), role))).expect(403);
      }
    });

    it("não há rotas de escrita em /audit: o registo não se altera pela API", async () => {
      const { auth } = await setup();
      await api().post("/audit").set("Authorization", auth).send({ action: "x.y" }).expect(404);
      await api().delete("/audit").set("Authorization", auth).expect(404);
    });

    const seed = async (count: number) => {
      const { admin, auth } = await setup();
      for (let i = 0; i < count; i++) {
        await prisma().auditEvent.create({
          data: { action: i % 2 === 0 ? "module.toggled" : "user.updated", actorId: admin.id, targetId: `t${i}`, createdAt: new Date(Date.UTC(2026, 10, 1, 10, i)) },
        });
      }
      return { admin, auth };
    };

    it("pagina por cursor, do mais recente para o mais antigo, sem repetir nem saltar", async () => {
      const { auth } = await seed(7);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await api().get("/audit").query({ limit: 3, ...(cursor ? { cursor } : {}) }).set("Authorization", auth).expect(200);
        seen.push(...res.body.items.map((e: { targetId: string }) => e.targetId));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(seen).toEqual(["t6", "t5", "t4", "t3", "t2", "t1", "t0"]);
    });

    it("eventos com a mesma data não se perdem entre páginas (desempate por id)", async () => {
      const { admin, auth } = await setup();
      const same = new Date(Date.UTC(2026, 10, 1, 10, 0, 0));
      for (let i = 0; i < 5; i++) await prisma().auditEvent.create({ data: { action: "module.toggled", actorId: admin.id, targetId: `m${i}`, createdAt: same } });

      const first = await api().get("/audit").query({ limit: 2 }).set("Authorization", auth).expect(200);
      const second = await api().get("/audit").query({ limit: 2, cursor: first.body.nextCursor }).set("Authorization", auth).expect(200);
      const third = await api().get("/audit").query({ limit: 2, cursor: second.body.nextCursor }).set("Authorization", auth).expect(200);
      const ids = [...first.body.items, ...second.body.items, ...third.body.items].map((e: { id: string }) => e.id);
      expect(new Set(ids).size).toBe(5);
      expect(third.body.nextCursor).toBeNull();
    });

    it("filtra por prefixo da ação, utilizador, alvo e intervalo de datas", async () => {
      const { admin, auth } = await seed(6);
      const q = async (query: Record<string, string>) =>
        (await api().get("/audit").query(query).set("Authorization", auth).expect(200)).body.items.map((e: { targetId: string }) => e.targetId);

      expect(await q({ action: "user." })).toEqual(["t5", "t3", "t1"]);
      expect(await q({ action: "module.toggled" })).toEqual(["t4", "t2", "t0"]);
      expect(await q({ actorId: admin.id, limit: "2" })).toEqual(["t5", "t4"]);
      expect(await q({ actorId: "00000000-0000-4000-8000-000000000000" })).toEqual([]);
      expect(await q({ targetId: "t3" })).toEqual(["t3"]);
      expect(await q({ from: "2026-11-01T10:02:00.000Z", to: "2026-11-01T10:04:00.000Z" })).toEqual(["t4", "t3", "t2"]);
    });

    it("valida os parâmetros (limite fora do intervalo, datas inválidas)", async () => {
      const { auth } = await setup();
      await api().get("/audit").query({ limit: 0 }).set("Authorization", auth).expect(400);
      await api().get("/audit").query({ limit: 101 }).set("Authorization", auth).expect(400);
      await api().get("/audit").query({ from: "ontem" }).set("Authorization", auth).expect(400);
      await api().get("/audit").query({ cursor: "lixo" }).set("Authorization", auth).expect(200); // cursor inválido = primeira página
    });
  });
});
