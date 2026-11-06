import { INestApplication } from "@nestjs/common";
import * as bcrypt from "bcrypt";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase, TEST_PASSWORD } from "./helpers";

// Este ficheiro usa uma instância própria da app para não esgotar o limite de 5 logins/min dos outros testes.
describe("Alterar e redefinir passwords (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prismaOf(app));
  });

  afterAll(async () => {
    await app.close();
  });

  const passwordMatches = async (email: string, password: string) => {
    const user = await prismaOf(app).user.findUniqueOrThrow({ where: { email } });
    return bcrypt.compare(password, user.passwordHash);
  };

  describe("o próprio utilizador altera a password (POST /auth/change-password)", () => {
    it("com a password atual certa: troca-a, termina as outras sessões e mantém a atual com tokens novos", async () => {
      const prisma = prismaOf(app);
      const user = await createUser(prisma, "COMERCIAL");
      await prisma.user.update({ where: { id: user.id }, data: { refreshToken: "sessao-antiga" } });

      const res = await api()
        .post("/auth/change-password")
        .set("Authorization", await bearerFor(app, user))
        .send({ currentPassword: TEST_PASSWORD, newPassword: "password-nova-123" })
        .expect(200);

      expect(await passwordMatches(user.email, "password-nova-123")).toBe(true);
      expect(await passwordMatches(user.email, TEST_PASSWORD)).toBe(false);

      // a sessão antiga (refresh token "sessao-antiga") deixou de servir: foi substituída pela da sessão atual
      const stored = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).refreshToken;
      expect(stored).not.toBeNull();
      expect(stored).not.toBe("sessao-antiga");
      expect(await bcrypt.compare(res.body.refreshToken, stored!)).toBe(true);

      // os tokens novos funcionam: a sessão de quem alterou a password continua
      await api().get("/auth/me").set("Authorization", `Bearer ${res.body.accessToken}`).expect(200);

      // e a nova password entra de facto
      await api().post("/auth/login").send({ email: user.email, password: "password-nova-123" }).expect(200);
    });

    it("com a password atual errada é recusado e nada muda", async () => {
      const user = await createUser(prismaOf(app), "COMERCIAL");
      await api()
        .post("/auth/change-password")
        .set("Authorization", await bearerFor(app, user))
        .send({ currentPassword: "errada-errada", newPassword: "password-nova-123" })
        .expect(400);
      expect(await passwordMatches(user.email, TEST_PASSWORD)).toBe(true);
    });

    it("a nova password tem de ter pelo menos 8 caracteres", async () => {
      const user = await createUser(prismaOf(app), "COMERCIAL");
      await api()
        .post("/auth/change-password")
        .set("Authorization", await bearerFor(app, user))
        .send({ currentPassword: TEST_PASSWORD, newPassword: "curta" })
        .expect(400);
    });

    it("exige sessão iniciada", async () => {
      await api().post("/auth/change-password").send({ currentPassword: "a", newPassword: "12345678" }).expect(401);
    });

    it("até o papel LEITURA_APENAS pode alterar a própria password", async () => {
      const user = await createUser(prismaOf(app), "LEITURA_APENAS");
      await api()
        .post("/auth/change-password")
        .set("Authorization", await bearerFor(app, user))
        .send({ currentPassword: TEST_PASSWORD, newPassword: "password-nova-123" })
        .expect(200);
    });
  });

  describe("o Administrador define a password de outro utilizador (POST /users/:id/password)", () => {
    it("troca a password e termina as sessões desse utilizador", async () => {
      const prisma = prismaOf(app);
      const admin = await createUser(prisma, "ADMINISTRADOR");
      const target = await createUser(prisma, "TECNICO");
      await prisma.user.update({ where: { id: target.id }, data: { refreshToken: "sessao-antiga" } });

      await api()
        .post(`/users/${target.id}/password`)
        .set("Authorization", await bearerFor(app, admin))
        .send({ newPassword: "definida-pelo-admin" })
        .expect(204);

      expect(await passwordMatches(target.email, "definida-pelo-admin")).toBe(true);
      expect(await passwordMatches(target.email, TEST_PASSWORD)).toBe(false);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).refreshToken).toBeNull();
    });

    it("utilizador inexistente dá 404 e password curta dá 400", async () => {
      const admin = await createUser(prismaOf(app), "ADMINISTRADOR");
      const auth = await bearerFor(app, admin);
      await api().post("/users/00000000-0000-4000-8000-000000000000/password").set("Authorization", auth).send({ newPassword: "12345678" }).expect(404);
      await api().post(`/users/${admin.id}/password`).set("Authorization", auth).send({ newPassword: "curta" }).expect(400);
    });
  });

  describe("utilizadores desativados", () => {
    it("não recebem email de recuperação nem a resposta revela se a conta existe", async () => {
      const prisma = prismaOf(app);
      const user = await createUser(prisma, "COMERCIAL");
      await prisma.user.update({ where: { id: user.id }, data: { active: false } });

      const inactive = await api().post("/auth/forgot-password").send({ email: user.email }).expect(200);
      const unknown = await api().post("/auth/forgot-password").send({ email: "ninguem@e2e.test" }).expect(200);
      expect(inactive.body).toEqual(unknown.body);
      // nenhum token de recuperação foi gerado para o desativado
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resetToken).toBeNull();
    });
  });
});
