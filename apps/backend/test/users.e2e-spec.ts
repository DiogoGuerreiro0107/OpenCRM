import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

describe("Gestão de utilizadores (e2e)", () => {
  let app: INestApplication;
  let admin: { id: string; email: string; role: string };
  let adminAuth: string;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    const prisma = prismaOf(app);
    await resetDatabase(prisma);
    admin = await createUser(prisma, "ADMINISTRADOR");
    adminAuth = await bearerFor(app, admin);
  });

  afterAll(async () => {
    await app.close();
  });

  const newUserBody = (overrides: Record<string, unknown> = {}) => ({
    name: "Nova Pessoa",
    email: "nova@e2e.test",
    role: "COMERCIAL",
    password: "password-inicial-1",
    ...overrides,
  });

  async function createManaged(overrides: Record<string, unknown> = {}) {
    const res = await api().post("/users").set("Authorization", adminAuth).send(newUserBody(overrides)).expect(201);
    return res.body as { id: string; email: string; role: Role; active: boolean };
  }

  describe("permissões", () => {
    it("só o Administrador gere utilizadores: os outros papéis recebem 403 em tudo", async () => {
      const prisma = prismaOf(app);
      const roles: Role[] = ["COMERCIAL", "TECNICO", "BACKOFFICE", "FINANCEIRO", "LEITURA_APENAS"];
      for (const role of roles) {
        const auth = await bearerFor(app, await createUser(prisma, role));
        await api().get("/users/manage").set("Authorization", auth).expect(403);
        await api().post("/users").set("Authorization", auth).send(newUserBody()).expect(403);
        await api().patch(`/users/${admin.id}`).set("Authorization", auth).send({ name: "x" }).expect(403);
        await api().post(`/users/${admin.id}/password`).set("Authorization", auth).send({ newPassword: "12345678" }).expect(403);
      }
    });

    it("GET /users (dropdowns) continua aberto a todos e mostra só os ativos", async () => {
      const comercial = await createUser(prismaOf(app), "COMERCIAL");
      const gone = await createManaged({ email: "saiu@e2e.test", name: "Saiu" });
      await api().patch(`/users/${gone.id}`).set("Authorization", adminAuth).send({ active: false }).expect(200);

      const res = await api().get("/users").set("Authorization", await bearerFor(app, comercial)).expect(200);
      const emails = res.body.map((u: { email: string }) => u.email);
      expect(emails).toContain(admin.email);
      expect(emails).not.toContain("saiu@e2e.test");
    });
  });

  describe("criar e listar", () => {
    it("cria um utilizador e ele aparece na lista de gestão, com desativados incluídos", async () => {
      const created = await createManaged();
      expect(created).toMatchObject({ email: "nova@e2e.test", role: "COMERCIAL", active: true });

      await api().patch(`/users/${created.id}`).set("Authorization", adminAuth).send({ active: false }).expect(200);
      const list = await api().get("/users/manage").set("Authorization", adminAuth).expect(200);
      expect(list.body.find((u: { id: string }) => u.id === created.id)).toMatchObject({ active: false });
    });

    it("nenhuma resposta contém hashes nem tokens", async () => {
      const created = await api().post("/users").set("Authorization", adminAuth).send(newUserBody()).expect(201);
      const list = await api().get("/users/manage").set("Authorization", adminAuth).expect(200);
      const patched = await api().patch(`/users/${created.body.id}`).set("Authorization", adminAuth).send({ name: "Outro" }).expect(200);

      for (const body of [created.body, list.body, patched.body]) {
        const text = JSON.stringify(body);
        expect(text).not.toMatch(/passwordHash|refreshToken|resetToken|password-inicial-1/);
      }
    });

    it("email duplicado (mesmo com outra capitalização) dá 409", async () => {
      await createManaged({ email: "dup@e2e.test" });
      await api().post("/users").set("Authorization", adminAuth).send(newUserBody({ email: "DUP@e2e.test" })).expect(409);
    });

    it("validação: password curta, email inválido e papel inexistente dão 400", async () => {
      await api().post("/users").set("Authorization", adminAuth).send(newUserBody({ password: "curta" })).expect(400);
      await api().post("/users").set("Authorization", adminAuth).send(newUserBody({ email: "nao-e-email" })).expect(400);
      await api().post("/users").set("Authorization", adminAuth).send(newUserBody({ role: "SUPERMAN" })).expect(400);
    });

    it("o utilizador criado consegue entrar com a password inicial", async () => {
      await createManaged({ email: "entra@e2e.test" });
      const res = await api().post("/auth/login").send({ email: "Entra@E2E.test", password: "password-inicial-1" }).expect(200);
      expect(res.body.user).toMatchObject({ email: "entra@e2e.test", role: "COMERCIAL" });
    });
  });

  describe("efeito imediato (o papel e o estado não vêm do token)", () => {
    it("desativar tira o acesso de imediato, mesmo com um token ainda válido", async () => {
      const victim = await createManaged({ email: "vitima@e2e.test" });
      const victimAuth = await bearerFor(app, { id: victim.id, email: victim.email, role: victim.role });
      await api().get("/companies").set("Authorization", victimAuth).expect(200);

      await api().patch(`/users/${victim.id}`).set("Authorization", adminAuth).send({ active: false }).expect(200);

      await api().get("/companies").set("Authorization", victimAuth).expect(401);
      await api().post("/auth/login").send({ email: victim.email, password: "password-inicial-1" }).expect(401);
    });

    it("reativar devolve o acesso", async () => {
      const user = await createManaged({ email: "volta@e2e.test" });
      const auth = await bearerFor(app, { id: user.id, email: user.email, role: user.role });
      await api().patch(`/users/${user.id}`).set("Authorization", adminAuth).send({ active: false }).expect(200);
      await api().get("/companies").set("Authorization", auth).expect(401);

      await api().patch(`/users/${user.id}`).set("Authorization", adminAuth).send({ active: true }).expect(200);
      await api().get("/companies").set("Authorization", auth).expect(200);
    });

    it("mudar o papel tem efeito imediato, mesmo com o papel antigo dentro do token", async () => {
      const user = await createManaged({ email: "promovido@e2e.test", role: "COMERCIAL" });
      // token emitido quando ainda era COMERCIAL
      const oldToken = await bearerFor(app, { id: user.id, email: user.email, role: "COMERCIAL" });
      await api().post("/companies").set("Authorization", oldToken).send({ name: "Empresa A" }).expect(201);

      await api().patch(`/users/${user.id}`).set("Authorization", adminAuth).send({ role: "LEITURA_APENAS" }).expect(200);

      await api().post("/companies").set("Authorization", oldToken).send({ name: "Empresa B" }).expect(403);
      await api().get("/companies").set("Authorization", oldToken).expect(200); // ainda lê
    });

    it("um token de um utilizador que entretanto deixou de existir é recusado", async () => {
      const ghost = await bearerFor(app, { id: "00000000-0000-4000-8000-000000000000", email: "x@e2e.test", role: "ADMINISTRADOR" });
      await api().get("/users/manage").set("Authorization", ghost).expect(401);
    });
  });

  describe("proteções contra ficar sem acesso", () => {
    it("o Administrador não se pode desativar nem despromover a si próprio", async () => {
      await api().patch(`/users/${admin.id}`).set("Authorization", adminAuth).send({ active: false }).expect(400);
      await api().patch(`/users/${admin.id}`).set("Authorization", adminAuth).send({ role: "COMERCIAL" }).expect(400);
      expect(await prismaOf(app).user.findUniqueOrThrow({ where: { id: admin.id } })).toMatchObject({
        active: true,
        role: "ADMINISTRADOR",
      });
    });

    it("pode mudar o próprio nome", async () => {
      const res = await api().patch(`/users/${admin.id}`).set("Authorization", adminAuth).send({ name: "Nome Novo" }).expect(200);
      expect(res.body.name).toBe("Nome Novo");
    });

    it("editar um utilizador que não existe dá 404", async () => {
      await api().patch("/users/00000000-0000-4000-8000-000000000000").set("Authorization", adminAuth).send({ name: "x" }).expect(404);
    });
  });
});
