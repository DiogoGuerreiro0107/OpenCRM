import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";
import { PermissionsService } from "../src/auth/permissions.service";
import { ModulesService } from "../src/modules/modules.service";

// Permissões de escrita configuráveis (pacote 0d, docs/plano-fase-0-fundacoes.md).
describe("Permissões configuráveis (e2e)", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const prisma = () => prismaOf(app);

  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(async () => {
    await resetDatabase(prisma());
    // O TRUNCATE apaga a configuração na base de dados; a cache em memória tem de acompanhar.
    await app.get(PermissionsService).reload();
    await app.get(ModulesService).reload();
  });

  afterAll(async () => {
    await app.close();
  });

  const as = async (role: Role) => bearerFor(app, await createUser(prisma(), role));
  const createCompany = (auth: string, name = "Acme") => api().post("/companies").set("Authorization", auth).send({ name });

  describe("sem configuração tudo fica como antes", () => {
    it("GET /me/permissions devolve a predefinição de cada papel", async () => {
      const expected: Record<string, string[]> = {
        ADMINISTRADOR: ["companies", "contacts", "leads", "deals", "dailyWork", "sendEmail", "makeCall", "emailTemplates"],
        COMERCIAL: ["companies", "contacts", "leads", "deals", "dailyWork", "sendEmail", "makeCall"],
        TECNICO: ["dailyWork", "makeCall"],
        BACKOFFICE: ["companies", "contacts", "leads", "deals", "dailyWork", "sendEmail", "makeCall", "emailTemplates"],
        FINANCEIRO: ["companies", "dailyWork"],
        LEITURA_APENAS: [],
      };
      for (const [role, areas] of Object.entries(expected)) {
        const res = await api().get("/me/permissions").set("Authorization", await as(role as Role)).expect(200);
        expect({ role, areas: res.body.writeAreas.sort() }).toEqual({ role, areas: [...areas].sort() });
      }
    });
  });

  describe("o Administrador muda uma área e tem efeito imediato", () => {
    it("dar «empresas» ao Técnico: passa a criar empresas E a preencher os campos delas; retirar volta a 403", async () => {
      const admin = await as("ADMINISTRADOR");
      const tecnico = await as("TECNICO");
      await createCompany(tecnico).expect(403);

      const res = await api()
        .patch("/permissions/companies")
        .set("Authorization", admin)
        .send({ roles: ["ADMINISTRADOR", "COMERCIAL", "BACKOFFICE", "FINANCEIRO", "TECNICO"] })
        .expect(200);
      expect(res.body.find((a: { area: string }) => a.area === "companies")).toMatchObject({ isDefault: false });

      const company = (await createCompany(tecnico).expect(201)).body;
      const field = (await api().post("/custom-fields").set("Authorization", admin).send({ entityType: "COMPANY", fieldLabel: "Nota", fieldType: "TEXT" }).expect(201)).body;
      await api()
        .post("/custom-fields/values")
        .set("Authorization", tecnico)
        .send({ entityType: "COMPANY", entityId: company.id, values: [{ customFieldId: field.id, value: "ok" }] })
        .expect(201);
      expect((await api().get("/me/permissions").set("Authorization", tecnico).expect(200)).body.writeAreas).toContain("companies");

      await api().patch("/permissions/companies").set("Authorization", admin).send({ roles: ["ADMINISTRADOR"] }).expect(200);
      await createCompany(tecnico).expect(403);
      await createCompany(await as("COMERCIAL")).expect(403); // também retirado ao Comercial
      await createCompany(admin).expect(201);
    });

    it("repor a predefinição", async () => {
      const admin = await as("ADMINISTRADOR");
      const comercial = await as("COMERCIAL");
      await api().patch("/permissions/companies").set("Authorization", admin).send({ roles: ["ADMINISTRADOR"] }).expect(200);
      await createCompany(comercial).expect(403);

      const res = await api().delete("/permissions/companies").set("Authorization", admin).expect(200);
      expect(res.body.find((a: { area: string }) => a.area === "companies")).toMatchObject({ isDefault: true });
      await createCompany(comercial).expect(201);
      expect(await prisma().permissionSetting.count()).toBe(0);
    });

    it("a configuração sobrevive a um reinício (está na base de dados)", async () => {
      const admin = await as("ADMINISTRADOR");
      await api().patch("/permissions/emailTemplates").set("Authorization", admin).send({ roles: ["ADMINISTRADOR", "COMERCIAL"] }).expect(200);
      await app.get(PermissionsService).reload(); // como no arranque
      expect(app.get(PermissionsService).rolesFor("emailTemplates")).toEqual(["ADMINISTRADOR", "COMERCIAL"]);
    });
  });

  describe("invariantes", () => {
    it("não se pode retirar o Administrador nem dar escrita a Leitura apenas", async () => {
      const admin = await as("ADMINISTRADOR");
      const noAdmin = await api().patch("/permissions/companies").set("Authorization", admin).send({ roles: ["COMERCIAL"] }).expect(400);
      expect(noAdmin.body.message).toContain("Administrador");
      const readOnly = await api().patch("/permissions/companies").set("Authorization", admin).send({ roles: ["ADMINISTRADOR", "LEITURA_APENAS"] }).expect(400);
      expect(readOnly.body.message).toContain("Leitura apenas");
      await api().patch("/permissions/companies").set("Authorization", admin).send({ roles: ["ADMINISTRADOR", "INVENTADO"] }).expect(400);
      expect(await prisma().permissionSetting.count()).toBe(0);
    });

    it("a administração não é uma área configurável", async () => {
      const admin = await as("ADMINISTRADOR");
      await api().patch("/permissions/adminOnly").set("Authorization", admin).send({ roles: ["ADMINISTRADOR", "COMERCIAL"] }).expect(404);
      await api().patch("/permissions/users").set("Authorization", admin).send({ roles: ["ADMINISTRADOR", "COMERCIAL"] }).expect(404);
      const list = await api().get("/permissions").set("Authorization", admin).expect(200);
      expect(list.body.map((a: { area: string }) => a.area)).not.toContain("adminOnly");
      // e a gestão de utilizadores continua só do Administrador mesmo dando todas as áreas a um Comercial
      for (const area of list.body.map((a: { area: string }) => a.area)) {
        await api().patch(`/permissions/${area}`).set("Authorization", admin).send({ roles: ["ADMINISTRADOR", "COMERCIAL"] }).expect(200);
      }
      const comercial = await as("COMERCIAL");
      await api().post("/users").set("Authorization", comercial).send({ name: "x", email: "x@e2e.test", role: "ADMINISTRADOR", password: "12345678" }).expect(403);
      await api().patch("/permissions/companies").set("Authorization", comercial).send({ roles: ["ADMINISTRADOR", "COMERCIAL", "TECNICO"] }).expect(403);
    });

    it("só o Administrador vê e altera a matriz; todos veem as suas próprias permissões", async () => {
      for (const role of ["COMERCIAL", "TECNICO", "BACKOFFICE", "FINANCEIRO", "LEITURA_APENAS"] as const) {
        const auth = await as(role);
        await api().get("/permissions").set("Authorization", auth).expect(403);
        await api().patch("/permissions/companies").set("Authorization", auth).send({ roles: ["ADMINISTRADOR"] }).expect(403);
        await api().delete("/permissions/companies").set("Authorization", auth).expect(403);
        await api().get("/me/permissions").set("Authorization", auth).expect(200);
      }
      await api().get("/me/permissions").expect(401);
    });
  });

  describe("auditoria", () => {
    it("alterar e repor ficam registados, com os papéis", async () => {
      const admin = await createUser(prisma(), "ADMINISTRADOR");
      const auth = await bearerFor(app, admin);
      await api().patch("/permissions/deals").set("Authorization", auth).send({ roles: ["ADMINISTRADOR", "TECNICO"] }).expect(200);
      await api().delete("/permissions/deals").set("Authorization", auth).expect(200);
      expect(await prisma().auditEvent.findFirstOrThrow({ where: { action: "permission.updated" } })).toMatchObject({
        actorId: admin.id,
        targetId: "deals",
        metadata: { roles: ["ADMINISTRADOR", "TECNICO"] },
      });
      expect(await prisma().auditEvent.count({ where: { action: "permission.reset", targetId: "deals" } })).toBe(1);
    });
  });
});
