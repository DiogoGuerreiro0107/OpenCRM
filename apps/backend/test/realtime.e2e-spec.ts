import { INestApplication } from "@nestjs/common";
import { AddressInfo } from "node:net";
import { io, Socket } from "socket.io-client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

type Evt = { resource: string; action: string };

describe("Tempo real: Socket.io (e2e)", () => {
  let app: INestApplication;
  let url: string;
  let admin: { id: string; email: string; role: string };
  let adminToken: string;
  const sockets: Socket[] = [];

  const api = () => request(app.getHttpServer());
  const rawToken = (bearer: string) => bearer.replace("Bearer ", "");

  /** Liga-se como um browser/cliente real. Sem `token`, tenta ligar-se sem autenticação. */
  function connect(opts: { token?: string; origin?: string } = {}) {
    const socket = io(url, {
      auth: opts.token ? { token: opts.token } : {},
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
      extraHeaders: opts.origin ? { Origin: opts.origin } : undefined,
    });
    sockets.push(socket);
    return socket;
  }

  const outcome = (socket: Socket) =>
    new Promise<"ligado" | "recusado">((resolve) => {
      socket.once("connect", () => resolve("ligado"));
      socket.once("connect_error", () => resolve("recusado"));
    });

  function collect(socket: Socket) {
    const events: Evt[] = [];
    socket.on("crm:event", (e: Evt) => events.push(e));
    return events;
  }
  const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    await resetDatabase(prismaOf(app));
    admin = await createUser(prismaOf(app), "ADMINISTRADOR");
    adminToken = rawToken(await bearerFor(app, admin));
  });

  afterEach(() => {
    while (sockets.length) sockets.pop()?.close();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("quem se pode ligar", () => {
    it("com um token válido liga-se", async () => {
      expect(await outcome(connect({ token: adminToken }))).toBe("ligado");
    });

    it("sem token é recusado", async () => {
      expect(await outcome(connect())).toBe("recusado");
    });

    it("com um token adulterado é recusado", async () => {
      expect(await outcome(connect({ token: adminToken.slice(0, -4) + "AAAA" }))).toBe("recusado");
    });

    it("com lixo no lugar do token é recusado", async () => {
      expect(await outcome(connect({ token: "isto-nao-e-um-jwt" }))).toBe("recusado");
    });

    it("um utilizador desativado é recusado, mesmo com um token ainda na validade", async () => {
      const prisma = prismaOf(app);
      const user = await createUser(prisma, "COMERCIAL");
      const token = rawToken(await bearerFor(app, user));
      await prisma.user.update({ where: { id: user.id }, data: { active: false } });
      expect(await outcome(connect({ token }))).toBe("recusado");
    });

    it("um token de um utilizador que não existe é recusado", async () => {
      const ghost = rawToken(await bearerFor(app, { id: "00000000-0000-4000-8000-000000000000", email: "x@e2e.test", role: "ADMINISTRADOR" }));
      expect(await outcome(connect({ token: ghost }))).toBe("recusado");
    });

    it("uma origem pública é recusada, mesmo com um token válido", async () => {
      expect(await outcome(connect({ token: adminToken, origin: "https://evil.example.com" }))).toBe("recusado");
    });

    it("a origem do frontend na rede local é aceite", async () => {
      expect(await outcome(connect({ token: adminToken, origin: "http://192.168.50.10:5173" }))).toBe("ligado");
    });
  });

  describe("o que recebem", () => {
    it("uma escrita bem-sucedida emite { resource, action } e MAIS NADA (nenhum dado de negócio)", async () => {
      const prisma = prismaOf(app);
      const pipeline = (await api().post("/pipelines").set("Authorization", `Bearer ${adminToken}`).send({ name: "Vendas" }).expect(201)).body;

      const client = connect({ token: adminToken });
      await outcome(client);
      const events = collect(client);

      await api()
        .post("/deals")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ title: "Negócio SEGREDO", pipelineId: pipeline.id, stageId: pipeline.stages[0].id, value: 98765 })
        .expect(201);
      await settle();

      expect(events).toEqual([{ resource: "deals", action: "POST" }]);
      const wire = JSON.stringify(events);
      expect(wire).not.toContain("SEGREDO");
      expect(wire).not.toContain("98765");
      expect(Object.keys(events[0]).sort()).toEqual(["action", "resource"]);
      expect(await prisma.deal.count()).toBe(1);
    });

    it("todos os clientes ligados recebem o aviso (é isso que faz o Kanban dos outros atualizar)", async () => {
      const a = connect({ token: adminToken });
      const b = connect({ token: adminToken });
      await Promise.all([outcome(a), outcome(b)]);
      const [ea, eb] = [collect(a), collect(b)];

      await api().post("/pipelines").set("Authorization", `Bearer ${adminToken}`).send({ name: "Vendas" }).expect(201);
      await settle();

      expect(ea).toEqual([{ resource: "pipelines", action: "POST" }]);
      expect(eb).toEqual([{ resource: "pipelines", action: "POST" }]);
    });

    it("as fases (/stages) contam como funis", async () => {
      const pipeline = (await api().post("/pipelines").set("Authorization", `Bearer ${adminToken}`).send({ name: "Vendas" }).expect(201)).body;
      const client = connect({ token: adminToken });
      await outcome(client);
      const events = collect(client);

      await api().patch(`/stages/${pipeline.stages[0].id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "Renomeada" }).expect(200);
      await settle();

      expect(events).toEqual([{ resource: "pipelines", action: "PATCH" }]);
    });

    it("um pedido RECUSADO não emite (nada mudou)", async () => {
      const comercial = rawToken(await bearerFor(app, await createUser(prismaOf(app), "COMERCIAL")));
      const client = connect({ token: adminToken });
      await outcome(client);
      const events = collect(client);

      await api().post("/pipelines").set("Authorization", `Bearer ${comercial}`).send({ name: "x" }).expect(403); // só Administrador
      await api().post("/companies").set("Authorization", `Bearer ${adminToken}`).send({}).expect(400); // validação
      await settle();

      expect(events).toEqual([]);
    });

    it("leituras e rotas /auth não emitem", async () => {
      const client = connect({ token: adminToken });
      await outcome(client);
      const events = collect(client);

      await api().get("/companies").set("Authorization", `Bearer ${adminToken}`).expect(200);
      await api().post("/auth/login").send({ email: admin.email, password: "errada-errada" }).expect(401);
      await settle();

      expect(events).toEqual([]);
    });

    it("a movimentação de um negócio por uma automação também avisa", async () => {
      const pipeline = (await api().post("/pipelines").set("Authorization", `Bearer ${adminToken}`).send({ name: "Vendas" }).expect(201)).body;
      const [novo, negociacao] = pipeline.stages;
      await api()
        .post("/automation-rules")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "r", pipelineId: pipeline.id, triggerType: "FIELD_CHANGED", triggerConfig: { field: "value", operator: "gt", value: 10 }, actionType: "MOVE_STAGE", actionConfig: { targetStageId: negociacao.id } })
        .expect(201);
      const deal = (await api().post("/deals").set("Authorization", `Bearer ${adminToken}`).send({ title: "d", pipelineId: pipeline.id, stageId: novo.id, value: 1 }).expect(201)).body;

      const client = connect({ token: adminToken });
      await outcome(client);
      const events = collect(client);
      await api().patch(`/deals/${deal.id}`).set("Authorization", `Bearer ${adminToken}`).send({ value: 500 }).expect(200);
      await settle();

      // o próprio PATCH (HTTP) e o movimento feito pela automação
      expect(events).toEqual(expect.arrayContaining([{ resource: "deals", action: "PATCH" }, { resource: "deals", action: "AUTOMATION" }]));
    });
  });

  describe("desativar um utilizador", () => {
    it("fecha-lhe as ligações abertas e deixa de receber eventos", async () => {
      const prisma = prismaOf(app);
      const user = await createUser(prisma, "COMERCIAL");
      const client = connect({ token: rawToken(await bearerFor(app, user)) });
      await outcome(client);
      const events = collect(client);
      const closed = new Promise<string>((resolve) => client.once("disconnect", resolve));

      await api().patch(`/users/${user.id}`).set("Authorization", `Bearer ${adminToken}`).send({ active: false }).expect(200);
      await closed;
      expect(client.connected).toBe(false);

      await api().post("/pipelines").set("Authorization", `Bearer ${adminToken}`).send({ name: "Depois" }).expect(201);
      await settle();
      expect(events).toEqual([]);
    });
  });
});
