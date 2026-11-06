import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { createTestApp, createUser, bearerFor, prismaOf, resetDatabase, TEST_PASSWORD } from "./helpers";

describe("Autenticação e segurança HTTP (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await resetDatabase(prismaOf(app));
  });

  afterAll(async () => {
    await app.close();
  });

  // Atenção: o login tem um limite de 5 tentativas/min por IP. Este ficheiro usa uma única instância da app,
  // por isso as tentativas de login estão todas contadas (ordem importa: o teste do limite é o último).

  it("cabeçalhos de segurança do helmet estão presentes", async () => {
    const res = await request(app.getHttpServer()).get("/auth/me");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("CORS: aceita o frontend na rede local e recusa sites públicos", async () => {
    const lan = await request(app.getHttpServer()).get("/auth/me").set("Origin", "http://192.168.50.10:5173");
    expect(lan.headers["access-control-allow-origin"]).toBe("http://192.168.50.10:5173");

    const evil = await request(app.getHttpServer()).get("/auth/me").set("Origin", "https://evil.example.com");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rotas protegidas recusam pedidos sem token ou com token inválido", async () => {
    await request(app.getHttpServer()).get("/companies").expect(401);
    await request(app.getHttpServer()).get("/companies").set("Authorization", "Bearer lixo").expect(401);
  });

  it("login válido devolve tokens e o utilizador (sem hash da password)", async () => {
    const user = await createUser(prismaOf(app), "COMERCIAL");
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: user.email, role: "COMERCIAL" });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");

    const me = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ email: user.email, role: "COMERCIAL" });
  });

  it("password errada e email desconhecido dão a mesma resposta (não revela que o email existe)", async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "comercial@e2e.test", password: "errada-errada" })
      .expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "ninguem@e2e.test", password: "errada-errada" })
      .expect(401);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it("um token adulterado é recusado", async () => {
    const user = await prismaOf(app).user.findFirstOrThrow();
    const forged = await bearerFor(app, user);
    const tampered = forged.slice(0, -4) + "AAAA";
    await request(app.getHttpServer()).get("/auth/me").set("Authorization", tampered).expect(401);
  });

  it("depois de 5 tentativas de login seguidas, responde 429 (limite anti força-bruta)", async () => {
    // já foram feitas 3 tentativas de login acima; mais 2 esgotam o limite de 5
    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer()).post("/auth/login").send({ email: "x@e2e.test", password: "errada-errada" });
    }
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "x@e2e.test", password: "errada-errada" })
      .expect(429);
  });
});
