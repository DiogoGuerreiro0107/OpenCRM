import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

describe("Timeline: editar/eliminar notas (e2e)", () => {
  let app: INestApplication;
  let comercial: string;
  let userId: string;

  const api = () => request(app.getHttpServer());
  const ENTITY = { entityType: "COMPANY", entityId: "entidade-de-teste" } as const;

  beforeAll(async () => {
    app = await createTestApp();
    const prisma = prismaOf(app);
    await resetDatabase(prisma);
    const user = await createUser(prisma, "COMERCIAL");
    userId = user.id;
    comercial = await bearerFor(app, user);
  });

  afterAll(async () => {
    await app.close();
  });

  it("uma nota manual pode ser editada e eliminada", async () => {
    const created = await api()
      .post("/timeline")
      .set("Authorization", comercial)
      .send({ ...ENTITY, type: "NOTE", description: "original" })
      .expect(201);

    const edited = await api()
      .patch(`/timeline/${created.body.id}`)
      .set("Authorization", comercial)
      .send({ description: "editada" })
      .expect(200);
    expect(edited.body.description).toBe("editada");

    await api().delete(`/timeline/${created.body.id}`).set("Authorization", comercial).expect(204);
    expect(await prismaOf(app).timelineEvent.count({ where: { id: created.body.id } })).toBe(0);
  });

  it("eventos gerados pelo sistema não podem ser editados nem eliminados (403)", async () => {
    const system = await prismaOf(app).timelineEvent.create({
      data: { ...ENTITY, type: "SYSTEM", description: "Empresa criada", userId },
    });

    await api().patch(`/timeline/${system.id}`).set("Authorization", comercial).send({ description: "x" }).expect(403);
    await api().delete(`/timeline/${system.id}`).set("Authorization", comercial).expect(403);
    expect(await prismaOf(app).timelineEvent.count({ where: { id: system.id } })).toBe(1);
  });

  it("editar um evento que não existe dá 404", async () => {
    await api()
      .patch("/timeline/00000000-0000-4000-8000-000000000000")
      .set("Authorization", comercial)
      .send({ description: "x" })
      .expect(404);
  });
});
