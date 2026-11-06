import { INestApplication } from "@nestjs/common";
import axios from "axios";
import * as request from "supertest";
import { AutomationsService } from "../src/automations/automations.service";
import { ModulesService } from "../src/modules/modules.service";
import { ZadarmaService } from "../src/zadarma/zadarma.service";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

describe("Módulos opcionais (e2e)", () => {
  let app: INestApplication;
  let admin: string;
  let comercial: string;

  const api = () => request(app.getHttpServer());
  const as = (auth: string) => ({ Authorization: auth });

  async function setModule(id: string, enabled: boolean, expected = 200) {
    return api().patch(`/modules/${id}`).set(as(admin)).send({ enabled }).expect(expected);
  }

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    const prisma = prismaOf(app);
    await resetDatabase(prisma);
    await app.get(ModulesService).reload(); // a base ficou vazia: tudo ativo por omissão
    admin = await bearerFor(app, await createUser(prisma, "ADMINISTRADOR"));
    comercial = await bearerFor(app, await createUser(prisma, "COMERCIAL"));
  });

  afterAll(async () => {
    await prismaOf(app).moduleSetting.deleteMany();
    await app.close();
  });

  describe("estado e permissões", () => {
    it("por omissão todos os módulos estão ativos", async () => {
      const res = await api().get("/modules").set(as(admin)).expect(200);
      expect(res.body.enabled.sort()).toEqual(["automations", "deals", "email", "leads", "zadarma"]);
    });

    it("qualquer utilizador autenticado vê o que está ativo, mas só o Administrador vê o detalhe e altera", async () => {
      await api().get("/modules").set(as(comercial)).expect(200);
      await api().get("/modules/manage").set(as(comercial)).expect(403);
      await api().patch("/modules/leads").set(as(comercial)).send({ enabled: false }).expect(403);
      await api().get("/modules").expect(401);
    });

    it("a lista de gestão traz dependências e dependentes ativos", async () => {
      const res = await api().get("/modules/manage").set(as(admin)).expect(200);
      const automations = res.body.find((m: { id: string }) => m.id === "automations");
      const deals = res.body.find((m: { id: string }) => m.id === "deals");
      expect(automations.dependsOn).toEqual(["deals"]);
      expect(deals.activeDependents).toEqual(["automations"]);
    });

    it("módulo inexistente dá 404 e um corpo inválido dá 400", async () => {
      await setModule("fantasma", false, 404);
      await api().patch("/modules/leads").set(as(admin)).send({ enabled: "talvez" }).expect(400);
    });
  });

  describe("rotas de um módulo desligado respondem 404 (e voltam ao ligar)", () => {
    // [módulo a desligar, módulos que é preciso desligar antes, rota de leitura]
    const CASES: Array<[string, string[], string]> = [
      ["leads", [], "/leads"],
      ["deals", ["automations"], "/deals"],
      ["deals", ["automations"], "/pipelines"],
      ["email", [], "/email/messages"],
      ["email", [], "/email-templates"],
      ["zadarma", [], "/zadarma/calls"],
      ["automations", [], "/automation-rules"],
    ];

    it.each(CASES)("%s desligado: GET %s", async (id, before, route) => {
      await api().get(route).set(as(admin)).expect(200);
      for (const dep of before) await setModule(dep, false);
      await setModule(id, false);

      await api().get(route).set(as(admin)).expect(404);

      await setModule(id, true);
      for (const dep of before) await setModule(dep, true);
      await api().get(route).set(as(admin)).expect(200);
    });

    it("as rotas de ESCRITA também ficam 404 (não 400 de validação)", async () => {
      await setModule("leads", false);
      await api().post("/leads").set(as(admin)).send({ name: "x" }).expect(404);
      await setModule("email", false);
      await api().post("/email/send").set(as(admin)).send({}).expect(404);
    });

    it("sem sessão continua a ser 401: não se revela que módulos estão desligados", async () => {
      await setModule("leads", false);
      await api().get("/leads").expect(401);
      await api().get("/leads").set(as("Bearer lixo")).expect(401);
    });

    it("os dados ficam: desligar e voltar a ligar devolve tudo", async () => {
      const lead = (await api().post("/leads").set(as(admin)).send({ name: "Lead que fica" }).expect(201)).body;
      await setModule("leads", false);
      await setModule("leads", true);
      const list = (await api().get("/leads").set(as(admin)).expect(200)).body;
      expect(list.map((l: { id: string }) => l.id)).toContain(lead.id);
    });

    it("o estado persiste na base de dados (sobrevive a recarregar a cache)", async () => {
      await setModule("zadarma", false);
      await app.get(ModulesService).reload();
      expect(app.get(ModulesService).isEnabled("zadarma")).toBe(false);
      await api().get("/zadarma/calls").set(as(admin)).expect(404);
    });
  });

  describe("dependências", () => {
    it("não se desliga negócios com as automações ativas (diz qual)", async () => {
      const res = await setModule("deals", false, 400);
      expect(res.body.message).toContain("Automações");
      await api().get("/deals").set(as(admin)).expect(200);
    });

    it("não se liga as automações com os negócios desligados (diz qual)", async () => {
      await setModule("automations", false);
      await setModule("deals", false);
      const res = await setModule("automations", true, 400);
      expect(res.body.message).toContain("Funis e negócios");
    });
  });

  describe("o núcleo nunca é afetado", () => {
    it("com todos os módulos opcionais desligados, empresas, contactos, tarefas, timeline e utilizadores funcionam", async () => {
      for (const id of ["automations", "deals", "leads", "email", "zadarma"]) await setModule(id, false);

      const company = (await api().post("/companies").set(as(admin)).send({ name: "Empresa sem módulos" }).expect(201)).body;
      await api().post("/contacts").set(as(admin)).send({ name: "Contacto sem módulos", companyId: company.id }).expect(201);
      await api().post("/tasks").set(as(admin)).send({ title: "Tarefa sem módulos" }).expect(201);
      await api().post("/timeline").set(as(admin)).send({ entityType: "COMPANY", entityId: company.id, type: "NOTE", description: "nota" }).expect(201);
      await api().get("/users").set(as(admin)).expect(200);
      await api().get("/custom-fields?entityType=COMPANY").set(as(admin)).expect(200);
      await api().get("/dashboard/summary").set(as(admin)).expect(200);
    });
  });

  describe("efeitos fora das rotas", () => {
    it("o dashboard só devolve os indicadores dos módulos ativos", async () => {
      const on = (await api().get("/dashboard/summary").set(as(admin)).expect(200)).body;
      expect(on.modules).toEqual({ leads: true, deals: true });
      expect(on.leadsNew).toEqual(expect.any(Number));
      expect(on.dealsOpen).toEqual(expect.any(Number));

      await setModule("automations", false);
      await setModule("deals", false);
      await setModule("leads", false);
      const off = (await api().get("/dashboard/summary").set(as(admin)).expect(200)).body;
      expect(off.modules).toEqual({ leads: false, deals: false });
      expect(off).toMatchObject({ leadsNew: null, dealsOpen: null, dealsWon: null, dealsLost: null, openValue: null, staleDeals: null, pipelines: [] });
      expect(off.companiesTotal).toEqual(expect.any(Number)); // o núcleo continua
      expect(off.tasksToday).toEqual(expect.any(Number));
    });

    it("sem o módulo de negócios a conversão de lead cria empresa e contacto, sem negócio nem funil", async () => {
      await setModule("automations", false);
      await setModule("deals", false);
      const lead = (await api().post("/leads").set(as(admin)).send({ name: "Ana", companyName: "Empresa Ana Lda" }).expect(201)).body;

      const res = await api().post(`/leads/${lead.id}/convert`).set(as(admin)).expect(201); // não há funil nenhum e não faz falta
      expect(res.body.deal).toBeNull();
      expect(res.body.company).toMatchObject({ name: "Empresa Ana Lda" });
      expect(res.body.lead).toMatchObject({ status: "CONVERTIDO", convertedDealId: null });
      expect(await prismaOf(app).deal.count()).toBe(0);

      // não se pode converter duas vezes, mesmo sem negócio para o provar
      await api().post(`/leads/${lead.id}/convert`).set(as(admin)).expect(400);
      expect(await prismaOf(app).company.count()).toBe(1);
    });

    it("com o módulo de negócios ligado a conversão continua a criar o negócio", async () => {
      await api().post("/pipelines").set(as(admin)).send({ name: "Vendas" }).expect(201);
      const lead = (await api().post("/leads").set(as(admin)).send({ name: "Rui", companyName: "Empresa Rui" }).expect(201)).body;
      const res = await api().post(`/leads/${lead.id}/convert`).set(as(admin)).expect(201);
      expect(res.body.deal).toMatchObject({ id: expect.any(String) });
    });

    describe("automações", () => {
      let pipeline: { id: string; stages: Array<{ id: string; name: string }> };
      let dealId: string;
      const stageOf = async () => (await prismaOf(app).deal.findUniqueOrThrow({ where: { id: dealId } })).stageId;

      beforeEach(async () => {
        pipeline = (await api().post("/pipelines").set(as(admin)).send({ name: "Vendas" }).expect(201)).body;
        const [novo, negociacao] = pipeline.stages;
        const make = (name: string, triggerType: string, triggerConfig: object) =>
          api().post("/automation-rules").set(as(admin)).send({ name, stageId: novo.id, pipelineId: pipeline.id, triggerType, triggerConfig, actionType: "MOVE_STAGE", actionConfig: { targetStageId: negociacao.id } }).expect(201);
        await make("tempo", "STAGE_IDLE_TIME", { days: 1 });
        await make("valor", "FIELD_CHANGED", { field: "value", operator: "gt", value: 10 });
        dealId = (await api().post("/deals").set(as(admin)).send({ title: "d", pipelineId: pipeline.id, stageId: novo.id, value: 1 }).expect(201)).body.id;
      });

      it("o gatilho de campo alterado não dispara com o módulo desligado e volta a disparar ao ligar", async () => {
        await setModule("automations", false);
        await api().patch(`/deals/${dealId}`).set(as(admin)).send({ value: 500 }).expect(200);
        expect(await stageOf()).toBe(pipeline.stages[0].id); // ficou onde estava

        await setModule("automations", true);
        await api().patch(`/deals/${dealId}`).set(as(admin)).send({ value: 900 }).expect(200);
        expect(await stageOf()).toBe(pipeline.stages[1].id);
      });

      it("o cron de 'tempo parado' não corre com o módulo desligado", async () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        await prismaOf(app).deal.update({ where: { id: dealId }, data: { stageEnteredAt: twoDaysAgo } });
        const automations = app.get(AutomationsService);

        await setModule("automations", false);
        await automations.evaluateIdleRules();
        expect(await stageOf()).toBe(pipeline.stages[0].id);

        await setModule("automations", true);
        await automations.evaluateIdleRules();
        expect(await stageOf()).toBe(pipeline.stages[1].id);
      });
    });

    it("a sincronização periódica da Zadarma não corre com o módulo desligado", async () => {
      await prismaOf(app).zadarmaAccount.create({ data: { apiKey: "k", apiSecret: "s", callerExtension: "100", active: true } });
      const request_ = jest.spyOn(axios, "request").mockResolvedValue({ data: { stats: [] } });
      try {
        const zadarma = app.get(ZadarmaService);

        await setModule("zadarma", false);
        await zadarma.syncCallHistory();
        expect(request_).not.toHaveBeenCalled();

        await setModule("zadarma", true);
        await zadarma.syncCallHistory();
        expect(request_).toHaveBeenCalledTimes(1);
      } finally {
        request_.mockRestore();
      }
    });

    describe("o email-worker", () => {
      const key = () => process.env.INTERNAL_API_KEY as string;

      it("pergunta se o módulo está ativo antes de ler o IMAP: ativo = 200, desligado = 404, sem chave = 401", async () => {
        await api().get("/email/worker-status").set("x-internal-api-key", key()).expect(200);
        await api().get("/email/worker-status").expect(401);
        await api().get("/email/worker-status").set("x-internal-api-key", "errada").expect(401);

        await setModule("email", false);
        await api().get("/email/worker-status").set("x-internal-api-key", key()).expect(404);
      });

      it("a ingestão de emails também fica 404 com o módulo desligado", async () => {
        await setModule("email", false);
        await api().post("/email/ingest").set("x-internal-api-key", key()).send({}).expect(404);
      });
    });
  });
});
