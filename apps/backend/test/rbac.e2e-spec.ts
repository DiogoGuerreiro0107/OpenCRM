import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as request from "supertest";
import { bearerFor, createTestApp, createUser, prismaOf, resetDatabase } from "./helpers";

const ROLES: Role[] = ["ADMINISTRADOR", "COMERCIAL", "TECNICO", "BACKOFFICE", "FINANCEIRO", "LEITURA_APENAS"];
const [A, C, T, B, F] = ["ADMINISTRADOR", "COMERCIAL", "TECNICO", "BACKOFFICE", "FINANCEIRO"] as Role[];
const UUID = "00000000-0000-4000-8000-000000000000";

type Verb = "get" | "post" | "patch" | "delete";
// [método, caminho, papéis que DEVEM passar o guard]. Corpo vazio: quem passa o guard falha depois na
// validação/404, quem não passa recebe 403 — assim nenhum dado é alterado.
const CASES: Array<[Verb, string, Role[]]> = [
  ["post", "/companies", [A, C, B, F]],
  ["patch", `/companies/${UUID}`, [A, C, B, F]],
  ["delete", `/contacts/${UUID}`, [A, C, B]],
  ["post", "/contacts", [A, C, B]],
  ["post", "/leads", [A, C, B]],
  ["post", `/leads/${UUID}/convert`, [A, C, B]],
  ["post", "/deals", [A, C, B]],
  ["post", "/tasks", [A, C, T, B, F]],
  ["post", "/timeline", [A, C, T, B, F]],
  ["post", "/custom-fields/values", [A, C, T, B, F]],
  ["post", "/custom-fields", [A]],
  ["post", "/pipelines", [A]],
  ["delete", `/stages/${UUID}`, [A]],
  ["post", "/automation-rules", [A]],
  ["post", "/email-templates", [A, B]],
  ["post", "/email/send", [A, C, B]],
  ["post", "/zadarma/call", [A, C, T, B]],
  ["post", "/zadarma/account", [A]],
  // leituras
  ["get", "/companies", ROLES],
  ["get", "/zadarma/calls", ROLES],
  ["get", "/pipelines", ROLES],
  ["get", "/automation-rules", [A]],
  ["get", "/zadarma/account", [A]],
];

describe("Matriz de permissões por papel (e2e)", () => {
  let app: INestApplication;
  const bearer: Partial<Record<Role, string>> = {};

  beforeAll(async () => {
    app = await createTestApp();
    const prisma = prismaOf(app);
    await resetDatabase(prisma);
    for (const role of ROLES) bearer[role] = await bearerFor(app, await createUser(prisma, role));
  });

  afterAll(async () => {
    await app.close();
  });

  describe.each(CASES)("%s %s", (verb, path, allowed) => {
    it.each(ROLES)("%s", async (role) => {
      const req = request(app.getHttpServer())[verb](path).set("Authorization", bearer[role]!);
      const res = verb === "get" || verb === "delete" ? await req : await req.send({});

      if (allowed.includes(role)) {
        // passou o guard (falha depois, na validação ou num 404) — o que importa é não ser 401/403
        expect([401, 403]).not.toContain(res.status);
      } else {
        expect(res.status).toBe(403);
      }
    });
  });
});
