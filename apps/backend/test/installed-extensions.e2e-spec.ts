import { INestApplication } from "@nestjs/common";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";
import { InstalledExtensionsService } from "../src/extensions/installed-extensions.service";
import { SecretsService } from "../src/common/secrets.service";
import { isEncrypted } from "../src/common/secrets";

// Fase E1.4 (docs/plano-fase-e1-extensoes.md): extensões instaladas da pasta. As de exemplo (test/fixtures/extensions)
// são copiadas para uma pasta temporária, para os testes poderem alterar ficheiros.
describe("Extensões instaladas (e2e)", () => {
  let app: INestApplication;
  let dir: string;
  const previousDir = process.env.EXTENSIONS_DIR;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  const service = () => app.get(InstalledExtensionsService);
  let admin: string;
  let adminId: string;
  let comercial: string;

  const copyFixtures = () => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(path.join(__dirname, "fixtures", "extensions"), dir, { recursive: true });
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencrm-extensoes-"));
    process.env.EXTENSIONS_DIR = dir;
    copyFixtures();
    app = await createTestApp();
  });

  beforeEach(async () => {
    // Esquece o código carregado no teste anterior (a base vai ser limpa).
    const unload = (service() as unknown as { unload(id: string): Promise<void> }).unload.bind(service());
    for (const id of ["ola-mundo", "falha-sempre", "sem-activate", "so-definicoes", "lenta"]) await unload(id);
    copyFixtures();
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    const user = await createUser(prisma(), "ADMINISTRADOR", "Ana Admin");
    adminId = user.id;
    admin = await bearerFor(app, user);
    comercial = await bearerFor(app, await createUser(prisma(), "COMERCIAL"));
  });

  afterAll(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.EXTENSIONS_DIR;
    else process.env.EXTENSIONS_DIR = previousDir;
  });

  type View = { id: string; status: string; checksum: string; approvedChecksum: string | null; subscriptions: string[]; lastError: string | null; disabledReason: string | null; consecutiveFailures: number; permissions: Array<{ permission: string; description: string }> };
  const rescan = async () => (await api().post("/extensions/installed/rescan").set("Authorization", admin).expect(200)).body as { directory: string; extensions: View[]; problems: Array<{ folder: string; errors: string[] }> };
  const list = async () => (await api().get("/extensions/installed").set("Authorization", admin).expect(200)).body as { extensions: View[] };
  const one = async (id: string) => (await list()).extensions.find((e) => e.id === id)!;
  const approve = (id: string, checksum: string) => api().post(`/extensions/installed/${id}/approve`).set("Authorization", admin).send({ checksum });
  const enable = (id: string) => api().post(`/extensions/installed/${id}/enable`).set("Authorization", admin);
  const disable = (id: string) => api().post(`/extensions/installed/${id}/disable`).set("Authorization", admin);
  const approveAndEnable = async (id: string) => {
    const ext = await one(id);
    await approve(id, ext.checksum).expect(200);
    return (await enable(id).expect(200)).body as View;
  };
  const stateOf = async (id: string) => (await prisma().installedExtension.findUniqueOrThrow({ where: { id } })).state as Record<string, unknown>;
  /** Os eventos chegam às extensões em segundo plano: espera até a condição se cumprir (no máximo 5 s). */
  const eventually = async (check: () => Promise<void>) => {
    const until = Date.now() + 5000;
    for (;;) {
      try {
        return await check();
      } catch (err) {
        if (Date.now() > until) throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  };
  /** Para verificar que algo NÃO aconteceu: dá tempo aos eventos em segundo plano. */
  const settle = () => new Promise((r) => setTimeout(r, 600));

  it("procura: regista as válidas por aprovar e diz porque recusa as outras; só o Administrador", async () => {
    await api().get("/extensions/installed").set("Authorization", comercial).expect(403);
    await api().post("/extensions/installed/rescan").set("Authorization", comercial).expect(403);
    await api().post("/extensions/installed/rescan").expect(401);
    const result = await rescan();
    expect(result.directory).toBe(dir);
    expect(result.extensions.map((e) => [e.id, e.status])).toEqual([
      ["falha-sempre", "pending"],
      ["lenta", "pending"],
      ["ola-mundo", "pending"],
      ["sem-activate", "pending"],
      ["so-definicoes", "pending"],
    ]);
    expect(result.extensions.every((e) => /^[a-f0-9]{64}$/.test(e.checksum) && e.approvedChecksum === null)).toBe(true);
    const problems = Object.fromEntries(result.problems.map((p) => [p.folder, p.errors]));
    expect(problems.leads).toEqual(["«leads»: é o id de uma extensão embutida"]);
    expect(problems["manifesto-invalido"]).toEqual(["«manifesto-invalido»: version tem de ser uma versão como 1.2.3"]);
    expect((await one("ola-mundo")).permissions).toEqual([{ permission: "secrets:own", description: "Guarda segredos próprios (palavras-passe, chaves), cifrados" }]);
    const audit = await prisma().auditEvent.findMany({ where: { action: "extension.rescanned" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: adminId, metadata: { found: ["falha-sempre", "lenta", "ola-mundo", "sem-activate", "so-definicoes"], problems: 2 } });

    // A pasta tem de ter o nome do id.
    fs.cpSync(path.join(dir, "so-definicoes"), path.join(dir, "outro-nome"), { recursive: true });
    const renamed = await rescan();
    expect(renamed.problems.find((p) => p.folder === "outro-nome")!.errors).toEqual(["«so-definicoes»: a pasta tem de ter o nome do id («outro-nome»)"]);
  });

  it("aprovar: só a impressão digital que se viu; ligar só aprovada", async () => {
    await rescan();
    const ext = await one("ola-mundo");
    expect((await enable("ola-mundo").expect(409)).body.message).toBe("Aprova a extensão antes de a ligar");
    await approve("ola-mundo", "a".repeat(64)).expect(409);
    await approve("ola-mundo", "nao-e-um-sha").expect(400);
    await api().post("/extensions/installed/ola-mundo/approve").set("Authorization", comercial).send({ checksum: ext.checksum }).expect(403);
    const approved = (await approve("ola-mundo", ext.checksum).expect(200)).body;
    expect(approved).toMatchObject({ status: "disabled", approvedChecksum: ext.checksum, approvedBy: { id: adminId, name: "Ana Admin" } });
    expect(await prisma().auditEvent.count({ where: { action: "extension.approved", actorId: adminId, targetId: "ola-mundo" } })).toBe(1);
    await api().post("/extensions/installed/nao-existe/approve").set("Authorization", admin).send({ checksum: ext.checksum }).expect(404);
  });

  it("ligada: lê as definições (segredo cifrado), guarda estado, recebe eventos; desligar chama deactivate", async () => {
    await rescan();
    // Definições antes de ligar (o segredo fica cifrado com o contexto das instaladas).
    await api().patch("/extensions/ola-mundo/settings").set("Authorization", admin).send({ saudacao: "Bom dia", token: "segredo-123" }).expect(200);
    const options = (await prisma().installedExtension.findUniqueOrThrow({ where: { id: "ola-mundo" } })).options as Record<string, string>;
    expect(isEncrypted(options.token)).toBe(true);
    expect(app.get(SecretsService).decrypt(options.token, "InstalledExtension.options.ola-mundo.token")).toBe("segredo-123");
    const view = (await api().get("/extensions/ola-mundo/settings").set("Authorization", admin).expect(200)).body;
    expect(view).toMatchObject({ values: { saudacao: "Bom dia" }, secretsSet: ["token"] });
    expect(JSON.stringify(view)).not.toContain("segredo-123");

    const enabled = await approveAndEnable("ola-mundo");
    expect(enabled).toMatchObject({ status: "enabled", subscriptions: ["lead.created"] });
    expect(await stateOf("ola-mundo")).toEqual({ ativadaCom: "Bom dia", token: "lido" });

    await api().post("/leads").set("Authorization", admin).send({ name: "Rita Sousa" }).expect(201);
    await api().post("/leads").set("Authorization", admin).send({ name: "Paulo Dias" }).expect(201);
    await eventually(async () => expect(await stateOf("ola-mundo")).toMatchObject({ leads: 2, ultimaLead: "Paulo Dias", tipo: "lead.created" }));

    const off = (await disable("ola-mundo").expect(200)).body;
    expect(off).toMatchObject({ status: "disabled", subscriptions: [] });
    expect(await stateOf("ola-mundo")).toMatchObject({ desligada: true });
    await api().post("/leads").set("Authorization", admin).send({ name: "Depois" }).expect(201);
    await settle();
    expect((await stateOf("ola-mundo")).leads).toBe(2);
    expect(await prisma().auditEvent.count({ where: { action: { in: ["extension.enabled", "extension.disabled"] }, actorId: adminId } })).toBe(2);
  });

  it("ficheiros alterados depois de aprovada: não liga; ligada, a procura desliga-a com aviso", async () => {
    await rescan();
    const ext = await one("ola-mundo");
    await approve("ola-mundo", ext.checksum).expect(200);
    fs.appendFileSync(path.join(dir, "ola-mundo", "index.js"), "\n// alterado\n");
    expect((await enable("ola-mundo").expect(409)).body.message).toBe("Os ficheiros mudaram depois de aprovada: aprova de novo");
    expect((await one("ola-mundo")).status).toBe("changed");
    // Aprovar a nova impressão digital volta a deixar ligar.
    const changed = await one("ola-mundo");
    expect(changed.checksum).not.toBe(ext.checksum);
    await approveAndEnable("ola-mundo");

    // Ligada e alterada: a procura desliga-a, com motivo, auditoria e aviso.
    fs.writeFileSync(path.join(dir, "ola-mundo", "novo.js"), "// ficheiro novo\n");
    const after = await rescan();
    expect(after.extensions.find((e) => e.id === "ola-mundo")).toMatchObject({ status: "changed", disabledReason: "Os ficheiros mudaram depois de aprovada: aprova de novo" });
    const alerts = (await api().get("/extensions/installed/alerts").set("Authorization", admin).expect(200)).body;
    expect(alerts).toEqual([{ id: "ola-mundo", name: "Olá mundo", reason: "Os ficheiros mudaram depois de aprovada: aprova de novo" }]);
    expect(await prisma().auditEvent.count({ where: { action: "extension.disabled_automatically", targetId: "ola-mundo", actorId: null } })).toBe(1);
    await api().post("/leads").set("Authorization", admin).send({ name: "Não conta" }).expect(201);
    await settle();
    expect((await stateOf("ola-mundo")).leads).toBeUndefined();
  });

  it("disjuntor: 5 falhas seguidas desligam a extensão; o evento original nunca falha", async () => {
    await rescan();
    await approveAndEnable("falha-sempre");
    for (let i = 0; i < 4; i++) await api().post("/leads").set("Authorization", admin).send({ name: `Lead ${i}` }).expect(201);
    await eventually(async () => expect(await one("falha-sempre")).toMatchObject({ consecutiveFailures: 4, lastError: "rebentou" }));
    await settle();
    expect(await one("falha-sempre")).toMatchObject({ status: "enabled", consecutiveFailures: 4 });
    await api().post("/leads").set("Authorization", admin).send({ name: "Quinta" }).expect(201);
    await eventually(async () =>
      expect(await one("falha-sempre")).toMatchObject({ status: "disabled_auto", disabledReason: "Desligada pelo disjuntor: 5 falhas seguidas. Última: rebentou" }),
    );
    expect((await api().get("/extensions/installed/alerts").set("Authorization", admin).expect(200)).body.map((a: { id: string }) => a.id)).toEqual(["falha-sempre"]);
    // Ligar de novo à mão recomeça a contagem e tira o aviso.
    expect(await enable("falha-sempre").expect(200).then((r) => r.body)).toMatchObject({ status: "enabled", consecutiveFailures: 0, disabledReason: null });
    expect((await api().get("/extensions/installed/alerts").set("Authorization", admin).expect(200)).body).toEqual([]);
    // A contagem recomeçou: uma falha não a desliga logo.
    await api().post("/leads").set("Authorization", admin).send({ name: "Sexta" }).expect(201);
    await eventually(async () => expect(await one("falha-sempre")).toMatchObject({ consecutiveFailures: 1 }));
    await settle();
    expect(await one("falha-sempre")).toMatchObject({ status: "enabled", consecutiveFailures: 1 });
  });

  it("evento que passa o limite de tempo conta como falha (e não prende os outros)", async () => {
    jest.spyOn(service() as unknown as { timeoutMs(): number }, "timeoutMs").mockReturnValue(100);
    try {
      await rescan();
      await approveAndEnable("lenta");
      await api().post("/leads").set("Authorization", admin).send({ name: "Lenta" }).expect(201);
      await eventually(async () => expect(await one("lenta")).toMatchObject({ status: "enabled", consecutiveFailures: 1, lastError: "evento lead.created: passou o limite de 0.1 s" }));
      // Um evento que corre bem recomeça a contagem.
      jest.spyOn(service() as unknown as { timeoutMs(): number }, "timeoutMs").mockReturnValue(5000);
      await api().post("/leads").set("Authorization", admin).send({ name: "Agora corre" }).expect(201);
      await eventually(async () => expect(await one("lenta")).toMatchObject({ status: "enabled", consecutiveFailures: 0 }));
    } finally {
      jest.restoreAllMocks();
    }
  });

  it("sem activate: não liga e diz porquê; só definições: liga sem código; dependência desligada: recusa", async () => {
    await rescan();
    const ext = await one("sem-activate");
    await approve("sem-activate", ext.checksum).expect(200);
    expect((await enable("sem-activate").expect(400)).body.message).toBe("A extensão não arrancou: O server não exporta activate(contexto)");
    expect(await one("sem-activate")).toMatchObject({ status: "disabled", lastError: "O server não exporta activate(contexto)" });

    expect(await approveAndEnable("so-definicoes")).toMatchObject({ status: "enabled", subscriptions: [] });

    await api().patch("/modules/leads").set("Authorization", admin).send({ enabled: false }).expect(200);
    const ola = await one("ola-mundo");
    await approve("ola-mundo", ola.checksum).expect(200);
    expect((await enable("ola-mundo").expect(400)).body.message).toBe("Liga primeiro: leads");
  });

  it("pasta que desaparece fica em falta (os dados ficam); ligadas voltam a ligar ao arrancar", async () => {
    await rescan();
    await approveAndEnable("ola-mundo");
    // Arranque de outra instância com a mesma base: liga a que estava ligada.
    await disable("ola-mundo").expect(200);
    await prisma().installedExtension.update({ where: { id: "ola-mundo" }, data: { enabled: true } });
    await service().onApplicationBootstrap();
    expect((await one("ola-mundo")).status).toBe("enabled");

    fs.rmSync(path.join(dir, "so-definicoes"), { recursive: true });
    const after = await rescan();
    expect(after.extensions.find((e) => e.id === "so-definicoes")!.status).toBe("missing");
    await approve("so-definicoes", "a".repeat(64)).expect(409);
  });

  it("comando dos segredos: inclui os das extensões instaladas", async () => {
    await rescan();
    await prisma().installedExtension.update({ where: { id: "ola-mundo" }, data: { options: { token: "em-claro" } } });
    const { countPlaintextSecrets, encryptStoredSecrets } = await import("../src/common/secrets-migration");
    const { deriveKey } = await import("../src/common/secrets");
    expect(await countPlaintextSecrets(prisma())).toBe(1);
    const reports = await encryptStoredSecrets(prisma(), [deriveKey(process.env.SECRETS_KEY!)]);
    expect(reports.find((r) => r.field.startsWith("InstalledExtension.options"))).toMatchObject({ encrypted: 1 });
    expect(await countPlaintextSecrets(prisma())).toBe(0);
  });
});
