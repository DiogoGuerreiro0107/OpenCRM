import { INestApplication } from "@nestjs/common";
import axios from "axios";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { ModulesService } from "../src/modules/modules.service";
import { JobsService } from "../src/jobs/jobs.service";
import { deriveKey, encryptSecret, isEncrypted } from "../src/common/secrets";
import { countPlaintextSecrets, encryptStoredSecrets } from "../src/common/secrets-migration";

// Fase E1.3 (docs/plano-fase-e1-extensoes.md): definições das extensões geradas a partir do manifesto.
describe("Definições das extensões (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);
  let admin: string;
  let comercial: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    await app.get(ModulesService).reload();
    admin = await bearerFor(app, await createUser(prisma(), "ADMINISTRADOR"));
    comercial = await bearerFor(app, await createUser(prisma(), "COMERCIAL"));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app.close();
  });

  const get = (id: string, auth = admin) => api().get(`/extensions/${id}/settings`).set("Authorization", auth);
  const patch = (id: string, body: unknown, auth = admin) => api().patch(`/extensions/${id}/settings`).set("Authorization", auth).send(body as object);

  it("só o Administrador; extensão desconhecida 404; sem definições 400", async () => {
    await get("leads", comercial).expect(403);
    await patch("leads", { mode: "COMPANY" }, comercial).expect(403);
    await api().get("/extensions/leads/settings").expect(401);
    await get("nao-existe").expect(404);
    await get("__proto__").expect(404);
    await patch("nao-existe", {}).expect(404);
    expect((await get("deals").expect(200)).body).toEqual({ extensionId: "deals", fields: [], values: {}, secretsSet: [] });
    expect((await patch("deals", {}).expect(400)).body.message).toBe("Esta extensão não tem definições");
    // A lista diz quem tem definições.
    const list = (await api().get("/extensions").set("Authorization", admin).expect(200)).body as Array<{ id: string; hasSettings: boolean }>;
    expect(list.filter((e) => e.hasSettings).map((e) => e.id).sort()).toEqual(["leads", "zadarma"]);
  });

  it("leads: o modo pelo formulário gerado é o mesmo das leads (mesma gravação)", async () => {
    const view = (await get("leads").expect(200)).body;
    expect(view).toMatchObject({ extensionId: "leads", values: { mode: "BOTH" }, secretsSet: [] });
    expect(view.fields[0]).toMatchObject({ key: "mode", type: "select", default: "BOTH" });

    const saved = (await patch("leads", { mode: "COMPANY" }).expect(200)).body;
    expect(saved.values).toEqual({ mode: "COMPANY" });
    expect((await api().get("/leads/settings").set("Authorization", comercial).expect(200)).body).toEqual({ mode: "COMPANY" });
    const person = await api().post("/leads").set("Authorization", admin).send({ kind: "PERSON", name: "Rita" }).expect(400);
    expect(person.body.message).toBe("O módulo de leads está configurado só para leads de empresa");
    // E o inverso: a rota antiga muda o que o formulário mostra.
    await api().patch("/leads/settings").set("Authorization", admin).send({ mode: "PERSON" }).expect(200);
    expect((await get("leads").expect(200)).body.values).toEqual({ mode: "PERSON" });

    const audit = await prisma().auditEvent.findMany({ where: { action: "extension.settings_updated" } });
    expect(audit.map((a) => a.metadata)).toEqual([{ changed: ["mode"] }]);
  });

  it("recusas: valores inválidos dizem quais; sem mudanças, sem auditoria", async () => {
    expect((await patch("leads", { mode: "OUTRO" }).expect(400)).body.message).toEqual(["Tipo de leads: escolhe uma das opções"]);
    expect((await patch("leads", { outro: 1 }).expect(400)).body.message).toEqual(["«outro» não é uma definição desta extensão"]);
    expect((await patch("leads", ["mode"]).expect(400)).body.message).toEqual(["as definições têm de ser um objeto"]);
    expect((await patch("leads", { mode: "" }).expect(400)).body.message).toEqual(["Tipo de leads: é obrigatório"]);
    // Primeira gravação da Zadarma sem as credenciais.
    expect((await patch("zadarma", { callerExtension: "100" }).expect(400)).body.message).toEqual(["API key: é obrigatório", "API secret: é obrigatório"]);
    expect((await patch("zadarma", { apiKey: "x".repeat(201), apiSecret: "s" }).expect(400)).body.message).toEqual(["API key: no máximo 200 caracteres"]);
    expect((await patch("zadarma", { apiKey: "k", apiSecret: "s", active: "sim" }).expect(400)).body.message).toEqual(["Conta ativa: tem de ser sim ou não"]);
    expect(await prisma().moduleSetting.count({ where: { moduleId: "zadarma" } })).toBe(0);

    await patch("leads", { mode: "BOTH" }).expect(200); // já era o valor por omissão
    expect(await prisma().auditEvent.count({ where: { action: "extension.settings_updated" } })).toBe(0);
  });

  it("Zadarma: liga e sincroniza com as definições; conta desligada não; apagar o opcional", async () => {
    await patch("zadarma", { apiKey: "k", apiSecret: "s", callerExtension: "100" }).expect(200);
    const spy = jest.spyOn(axios, "request").mockResolvedValue({ data: { stats: [{ pbx_call_id: "c1", from: "210000000", to: "100", direction: "in", duration: 5 }] } });
    await api().post("/zadarma/call").set("Authorization", admin).send({ phoneNumber: "912345678" }).expect(201);
    expect(String((spy.mock.calls[0][0] as { url: string }).url)).toContain("/v1/request/callback/?from=100&to=912345678");

    // O estado junta-se ao que lá está (outras chaves ficam).
    await app.get(ModulesService).setState("zadarma", { outra: "fica" });
    const run = (await api().post("/jobs/zadarma.sync/run").set("Authorization", admin).expect(200)).body.run;
    expect(run).toMatchObject({ status: "SUCCESS", summary: "1 chamada nova" });
    const state = await app.get(ModulesService).getState("zadarma");
    expect(typeof state.lastSyncAt).toBe("string");
    expect(state.outra).toBe("fica");
    // O estado não é uma definição: não sai pela API.
    expect(JSON.stringify((await get("zadarma").expect(200)).body)).not.toContain("lastSyncAt");
    // A sincronização seguinte começa onde a anterior acabou.
    spy.mockClear();
    await app.get(JobsService).trigger("zadarma.sync");
    const next = new URL(String((spy.mock.calls[0][0] as { url: string }).url));
    expect(next.searchParams.get("start")).toBe(String(state.lastSyncAt).slice(0, 19).replace("T", " "));

    // Sem extensão que liga: recusa ligar.
    await patch("zadarma", { callerExtension: "" }).expect(200);
    expect((await get("zadarma").expect(200)).body.values.callerExtension).toBeNull();
    expect((await api().post("/zadarma/call").set("Authorization", admin).send({ phoneNumber: "912345678" }).expect(400)).body.message).toMatch(/Configura a tua extensão/);

    // Conta desligada: não liga nem sincroniza.
    await patch("zadarma", { active: false, callerExtension: "100" }).expect(200);
    await api().post("/zadarma/call").set("Authorization", admin).send({ phoneNumber: "912345678" }).expect(404);
    expect((await api().post("/jobs/zadarma.sync/run").set("Authorization", admin).expect(200)).body.run.summary).toBe("Sem conta ativa");
  });

  it("comando dos segredos: cifra os das definições que estejam em claro e roda os de uma chave anterior", async () => {
    const current = deriveKey(process.env.SECRETS_KEY!);
    const previous = deriveKey("chave-anterior-de-teste-com-mais-de-32-caracteres");
    await prisma().moduleSetting.create({ data: { moduleId: "zadarma", enabled: true, options: { apiKey: "k", apiSecret: "segredo-em-claro" } } });
    expect(await countPlaintextSecrets(prisma())).toBe(1);

    let reports = await encryptStoredSecrets(prisma(), [current]);
    expect(reports.find((r) => r.field.startsWith("ModuleSetting.options"))).toMatchObject({ encrypted: 1, recrypted: 0, unchanged: 0 });
    const stored = String(((await prisma().moduleSetting.findUniqueOrThrow({ where: { moduleId: "zadarma" } })).options as Record<string, unknown>).apiSecret);
    expect(isEncrypted(stored)).toBe(true);
    expect(await countPlaintextSecrets(prisma())).toBe(0);
    await app.get(ModulesService).reload();
    expect((await get("zadarma").expect(200)).body).toMatchObject({ values: { apiKey: "k" }, secretsSet: ["apiSecret"] });

    // Cifrado com a chave anterior: recifra com a atual, sem mexer nas outras definições.
    const old = encryptSecret("segredo-antigo", previous, "ModuleSetting.options.zadarma.apiSecret");
    await prisma().moduleSetting.update({ where: { moduleId: "zadarma" }, data: { options: { apiKey: "k", apiSecret: old, callerExtension: "100" } } });
    reports = await encryptStoredSecrets(prisma(), [current, previous]);
    expect(reports.find((r) => r.field.startsWith("ModuleSetting.options"))).toMatchObject({ encrypted: 0, recrypted: 1 });
    const options = (await prisma().moduleSetting.findUniqueOrThrow({ where: { moduleId: "zadarma" } })).options as Record<string, unknown>;
    expect(options).toMatchObject({ apiKey: "k", callerExtension: "100" });
    expect(options.apiSecret).not.toBe(old);
    reports = await encryptStoredSecrets(prisma(), [current]);
    expect(reports.find((r) => r.field.startsWith("ModuleSetting.options"))).toMatchObject({ unchanged: 1 });
  });
});
