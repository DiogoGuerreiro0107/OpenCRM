import { INestApplication } from "@nestjs/common";
import axios from "axios";
import * as nodemailer from "nodemailer";
import * as request from "supertest";
import * as bcrypt from "bcrypt";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase, TEST_PASSWORD } from "./helpers";
import { EmailService } from "../src/email/email.service";
import { SecretsService } from "../src/common/secrets.service";
import { deriveKey, encryptSecret, hashToken, isEncrypted } from "../src/common/secrets";
import { countPlaintextSecrets, encryptStoredSecrets } from "../src/common/secrets-migration";
import { signZadarmaRequest } from "../src/zadarma/zadarma.utils";
import { ModulesService } from "../src/modules/modules.service";
import { ZadarmaService } from "../src/zadarma/zadarma.service";

// Segredos de integrações cifrados em repouso (pacote E0a, docs/plano-e0-api-publica.md). Instância própria da app
// porque usa os endpoints de recuperação de password, que têm um limite estrito por minuto.
describe("Segredos em repouso (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prismaOf(app));
    await app.get(ModulesService).reload();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const adminAuth = async () => bearerFor(app, await createUser(prismaOf(app), "ADMINISTRADOR"));

  describe("Zadarma: apiSecret (definições da extensão, E1.3)", () => {
    const SECRET = "segredo-zadarma-em-claro-123";
    const storedOptions = async () => ((await prismaOf(app).moduleSetting.findUniqueOrThrow({ where: { moduleId: "zadarma" } })).options ?? {}) as Record<string, unknown>;
    const save = (auth: string, body: Record<string, unknown>) => api().patch("/extensions/zadarma/settings").set("Authorization", auth).send(body);

    it("guardado cifrado, nunca em claro, e a API nunca o devolve", async () => {
      const auth = await adminAuth();
      const res = await save(auth, { apiKey: "chave-publica", apiSecret: SECRET, callerExtension: "100" }).expect(200);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
      expect(res.body).toMatchObject({ values: { apiKey: "chave-publica", callerExtension: "100", active: true }, secretsSet: ["apiSecret"] });
      expect(res.body.values).not.toHaveProperty("apiSecret");

      const stored = String((await storedOptions()).apiSecret);
      expect(isEncrypted(stored)).toBe(true);
      expect(stored).not.toContain(SECRET);
      // O contexto é o do campo desta extensão: não decifra noutro.
      expect(app.get(SecretsService).decrypt(stored, "ModuleSetting.options.zadarma.apiSecret")).toBe(SECRET);
      expect(() => app.get(SecretsService).decrypt(stored, "ModuleSetting.options.email.apiSecret")).toThrow();

      const get = await api().get("/extensions/zadarma/settings").set("Authorization", auth).expect(200);
      expect(JSON.stringify(get.body)).not.toContain(SECRET);
      expect(JSON.stringify((await api().get("/extensions").set("Authorization", auth).expect(200)).body)).not.toContain(SECRET);
    });

    it("os pedidos à Zadarma são assinados com o segredo DECIFRADO", async () => {
      const auth = await adminAuth();
      await save(auth, { apiKey: "chave-publica", apiSecret: SECRET, callerExtension: "100" }).expect(200);

      const spy = jest.spyOn(axios, "request").mockResolvedValue({ data: {} });
      await api().post("/zadarma/call").set("Authorization", auth).send({ phoneNumber: "+351912345678" }).expect(201);

      const expected = signZadarmaRequest("chave-publica", SECRET, "/v1/request/callback/", { from: "100", to: "+351912345678" });
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0][0] as { headers: { Authorization: string } }).headers.Authorization).toBe(expected.authorization);
    });

    it("atualizar sem enviar o segredo mantém o cifrado; enviar um novo substitui-o; não se apaga um obrigatório", async () => {
      const auth = await adminAuth();
      await save(auth, { apiKey: "k", apiSecret: SECRET }).expect(200);
      const first = (await storedOptions()).apiSecret;

      await save(auth, { callerExtension: "200" }).expect(200);
      expect((await storedOptions()).apiSecret).toBe(first);

      await save(auth, { apiSecret: "outro-segredo-novo" }).expect(200);
      const replaced = String((await storedOptions()).apiSecret);
      expect(replaced).not.toBe(first);
      expect(isEncrypted(replaced)).toBe(true);
      expect(replaced).not.toContain("outro-segredo-novo");
      expect(app.get(SecretsService).decrypt(replaced, "ModuleSetting.options.zadarma.apiSecret")).toBe("outro-segredo-novo");

      const cleared = await save(auth, { apiSecret: "" }).expect(400);
      expect(cleared.body.message).toEqual(["API secret: é obrigatório"]);
      expect((await storedOptions()).apiSecret).toBe(replaced);
    });

    it("a conta da tabela antiga passa para as definições ao arrancar (uma vez), com o segredo recifrado", async () => {
      const prisma = prismaOf(app);
      const zadarma = app.get(ZadarmaService);
      const lastSyncAt = new Date("2026-11-20T10:00:00Z");
      await prisma.zadarmaAccount.create({
        data: { apiKey: "chave-antiga", apiSecret: app.get(SecretsService).encrypt(SECRET, "ZadarmaAccount.apiSecret"), callerExtension: "101", active: false, lastSyncAt },
      });
      expect(await zadarma.migrateLegacyAccount()).toBe(true);
      const options = await storedOptions();
      expect(options).toMatchObject({ apiKey: "chave-antiga", callerExtension: "101", active: false });
      expect(app.get(SecretsService).decrypt(String(options.apiSecret), "ModuleSetting.options.zadarma.apiSecret")).toBe(SECRET);
      expect(await app.get(ModulesService).getState("zadarma")).toEqual({ lastSyncAt: lastSyncAt.toISOString() });
      // Uma vez: com credenciais nas definições, não volta a copiar (nem por cima de alterações).
      const auth = await adminAuth();
      await save(auth, { apiKey: "chave-nova" }).expect(200);
      expect(await zadarma.migrateLegacyAccount()).toBe(false);
      expect((await storedOptions()).apiKey).toBe("chave-nova");
    });

    it("cópia da tabela antiga com o segredo ainda em claro (antes da E0a)", async () => {
      await prismaOf(app).zadarmaAccount.create({ data: { apiKey: "k", apiSecret: "zadarma-em-claro", active: true } });
      expect(await app.get(ZadarmaService).migrateLegacyAccount()).toBe(true);
      const stored = String((await storedOptions()).apiSecret);
      expect(isEncrypted(stored)).toBe(true);
      expect(app.get(SecretsService).decrypt(stored, "ModuleSetting.options.zadarma.apiSecret")).toBe("zadarma-em-claro");
    });

    it("sem tabela antiga, ou com a chave errada, não copia nem falha", async () => {
      expect(await app.get(ZadarmaService).migrateLegacyAccount()).toBe(false);
      await prismaOf(app).zadarmaAccount.create({ data: { apiKey: "k", apiSecret: encryptSecret("x", deriveKey("outra-chave-qualquer-com-32-caracteres-ou-mais"), "ZadarmaAccount.apiSecret") } });
      expect(await app.get(ZadarmaService).migrateLegacyAccount()).toBe(false);
      expect((await storedOptions().catch(() => ({}))) as Record<string, unknown>).not.toHaveProperty("apiKey");
    });
  });

  describe("Email: password da caixa", () => {
    const account = (password: string) => ({
      email: "crm@e2e.test",
      imapHost: "imap.e2e.test",
      imapPort: 993,
      smtpHost: "smtp.e2e.test",
      smtpPort: 465,
      username: "crm@e2e.test",
      password,
    });

    const captureTransport = () => {
      const sendMail = jest.fn().mockResolvedValue({ messageId: "<msg@e2e.test>" });
      const create = jest.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail } as never);
      return { sendMail, create };
    };

    it("o envio usa a password decifrada", async () => {
      const auth = await adminAuth();
      const stored = app.get(SecretsService).encrypt("password-da-caixa", "EmailAccount.password");
      await prismaOf(app).emailAccount.create({ data: account(stored) });
      const { create } = captureTransport();

      await api().post("/email/send").set("Authorization", auth).send({ to: ["cliente@e2e.test"], subject: "Olá", text: "texto" }).expect(201);

      const options = create.mock.calls[0][0] as { auth: { pass: string } };
      expect(options.auth.pass).toBe("password-da-caixa");
    });

    it("um valor ainda em claro (instalação anterior) continua a funcionar", async () => {
      const auth = await adminAuth();
      await prismaOf(app).emailAccount.create({ data: account("password-antiga-em-claro") });
      const { create } = captureTransport();

      await api().post("/email/send").set("Authorization", auth).send({ to: ["cliente@e2e.test"], subject: "Olá", text: "texto" }).expect(201);

      expect((create.mock.calls[0][0] as { auth: { pass: string } }).auth.pass).toBe("password-antiga-em-claro");
    });
  });

  describe("comando de migração (secrets:encrypt)", () => {
    const keyA = deriveKey("chave-atual-de-testes-com-mais-de-32-caracteres");
    const keyB = deriveKey("chave-antiga-de-testes-com-mais-de-32-caracteres");

    const seedPlain = async () => {
      const prisma = prismaOf(app);
      await prisma.zadarmaAccount.create({ data: { apiKey: "k", apiSecret: "zadarma-em-claro" } });
      await prisma.emailAccount.create({
        data: {
          email: "a@e2e.test",
          imapHost: "h",
          imapPort: 993,
          smtpHost: "h",
          smtpPort: 465,
          username: "a@e2e.test",
          password: "email-em-claro",
        },
      });
    };

    it("cifra o que está em claro, é idempotente e conta sem revelar valores", async () => {
      const prisma = prismaOf(app);
      await seedPlain();
      expect(await countPlaintextSecrets(prisma)).toBe(2);

      const first = await encryptStoredSecrets(prisma, [keyA]);
      // Só os dois campos semeados aqui (a lista cresce com cada segredo novo, p. ex. os dos webhooks).
      const seeded = ["EmailAccount.password", "ZadarmaAccount.apiSecret"];
      const counts = (report: typeof first) => report.filter((r) => seeded.includes(r.field)).map((r) => [r.field, r.encrypted, r.recrypted, r.unchanged]);
      expect(counts(first)).toEqual([
        ["EmailAccount.password", 1, 0, 0],
        ["ZadarmaAccount.apiSecret", 1, 0, 0],
      ]);
      expect(first.filter((r) => !seeded.includes(r.field)).every((r) => r.encrypted + r.recrypted + r.unchanged === 0)).toBe(true);
      expect(JSON.stringify(first)).not.toMatch(/em-claro/);
      expect(await countPlaintextSecrets(prisma)).toBe(0);

      const snapshot = (await prisma.zadarmaAccount.findFirstOrThrow()).apiSecret;
      const second = await encryptStoredSecrets(prisma, [keyA]);
      expect(counts(second)).toEqual([
        ["EmailAccount.password", 0, 0, 1],
        ["ZadarmaAccount.apiSecret", 0, 0, 1],
      ]);
      expect((await prisma.zadarmaAccount.findFirstOrThrow()).apiSecret).toBe(snapshot); // nem sequer é regravado
    });

    it("rotação: recifra o que estava com a chave anterior", async () => {
      const prisma = prismaOf(app);
      await prisma.zadarmaAccount.create({ data: { apiKey: "k", apiSecret: encryptSecret("zadarma-antigo", keyB, "ZadarmaAccount.apiSecret") } });

      const report = await encryptStoredSecrets(prisma, [keyA, keyB]);
      expect(report.find((r) => r.field === "ZadarmaAccount.apiSecret")).toMatchObject({ recrypted: 1, encrypted: 0 });

      const stored = (await prisma.zadarmaAccount.findFirstOrThrow()).apiSecret;
      // já só decifra com a chave atual
      await expect(encryptStoredSecrets(prisma, [keyB])).rejects.toThrow(/decifrar ZadarmaAccount.apiSecret/);
      expect((await prisma.zadarmaAccount.findFirstOrThrow()).apiSecret).toBe(stored);
    });

    it("chave errada falha SEM alterar nada na base de dados", async () => {
      const prisma = prismaOf(app);
      const original = encryptSecret("segredo", keyB, "ZadarmaAccount.apiSecret");
      await prisma.zadarmaAccount.create({ data: { apiKey: "k", apiSecret: original } });
      await expect(encryptStoredSecrets(prisma, [keyA])).rejects.toThrow(/decifrar/);
      expect((await prisma.zadarmaAccount.findFirstOrThrow()).apiSecret).toBe(original);
    });
  });

  describe("recuperação de password: token", () => {
    it("na base de dados só existe o hash; o token do email funciona uma vez", async () => {
      const prisma = prismaOf(app);
      const user = await createUser(prisma, "COMERCIAL");

      let emailText = "";
      jest.spyOn(app.get(EmailService), "sendRaw").mockImplementation(async (_to, _subject, text) => {
        emailText = text;
      });
      await api().post("/auth/forgot-password").send({ email: user.email }).expect(200);

      const token = emailText.match(/token=([0-9a-f]{64})/)?.[1];
      expect(token).toBeDefined();
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.resetTokenHash).toBe(hashToken(token!));
      expect(stored.resetTokenHash).not.toBe(token);

      await api().post("/auth/reset-password").send({ token, newPassword: "Nova-password-1" }).expect(200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(await bcrypt.compare("Nova-password-1", after.passwordHash)).toBe(true);
      expect(after.resetTokenHash).toBeNull();

      // reutilizar o mesmo token falha
      await api().post("/auth/reset-password").send({ token, newPassword: "Outra-password-2" }).expect(400);
    });

    it("o hash guardado NÃO serve como token (quem lê a base de dados não consegue redefinir passwords)", async () => {
      const prisma = prismaOf(app);
      const user = await createUser(prisma, "COMERCIAL");
      jest.spyOn(app.get(EmailService), "sendRaw").mockResolvedValue(undefined);
      await api().post("/auth/forgot-password").send({ email: user.email }).expect(200);

      const { resetTokenHash } = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      await api().post("/auth/reset-password").send({ token: resetTokenHash, newPassword: "Nova-password-1" }).expect(400);
      expect(await bcrypt.compare(TEST_PASSWORD, (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash)).toBe(true);
    });
  });
});
