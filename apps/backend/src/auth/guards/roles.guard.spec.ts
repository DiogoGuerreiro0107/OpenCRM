import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { Roles, WriteArea, WriteRoles } from "../decorators/roles.decorator";
import { RolesGuard } from "./roles.guard";
import { PermissionsService } from "../permissions.service";

// Controllers de mentira, só para o Reflector ter metadados reais para ler.
class NoPolicyController {
  handler() {}
}

@WriteRoles("ADMINISTRADOR", "COMERCIAL")
class ClassWriteController {
  handler() {}

  @WriteRoles("ADMINISTRADOR")
  adminOnlyHandler() {}
}

@Roles("ADMINISTRADOR")
class AdminOnlyController {
  handler() {}
}

@WriteArea("companies")
class AreaController {
  handler() {}

  @WriteRoles("ADMINISTRADOR")
  fixedHandler() {}
}

@WriteRoles("ADMINISTRADOR")
class FixedClassWithAreaHandler {
  @WriteArea("companies")
  handler() {}
}

function contextFor(controller: new () => object, handlerName: string, method: string, role?: Role): ExecutionContext {
  const handler = (controller.prototype as Record<string, () => void>)[handlerName];
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ method, user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe("RolesGuard", () => {
  // Permissões configuráveis simuladas: "companies" começa com Administrador + Comercial; os testes mudam-nas.
  let companies: Role[] = ["ADMINISTRADOR", "COMERCIAL"];
  const permissions = { rolesFor: (area: string) => (area === "companies" ? companies : []) } as unknown as PermissionsService;
  const guard = new RolesGuard(new Reflector(), permissions);
  beforeEach(() => {
    companies = ["ADMINISTRADOR", "COMERCIAL"];
  });
  const run = (c: new () => object, h: string, method: string, role?: Role) =>
    guard.canActivate(contextFor(c, h, method, role));

  describe("leitura (GET)", () => {
    it("sem política, qualquer papel lê", () => {
      for (const role of ["ADMINISTRADOR", "LEITURA_APENAS", "FINANCEIRO"] as Role[]) {
        expect(run(NoPolicyController, "handler", "GET", role)).toBe(true);
      }
    });

    it("@WriteRoles não afeta a leitura", () => {
      expect(run(ClassWriteController, "handler", "GET", "TECNICO")).toBe(true);
      expect(run(ClassWriteController, "handler", "GET", "LEITURA_APENAS")).toBe(true);
    });
  });

  describe("escrita falha em segurança", () => {
    it.each(["POST", "PATCH", "PUT", "DELETE"])("%s sem política é recusado, mesmo para o Administrador", (method) => {
      expect(() => run(NoPolicyController, "handler", method, "ADMINISTRADOR")).toThrow(ForbiddenException);
    });
  });

  describe("@WriteRoles", () => {
    it.each(["POST", "PATCH", "PUT", "DELETE"])("%s: só os papéis listados escrevem", (method) => {
      expect(run(ClassWriteController, "handler", method, "ADMINISTRADOR")).toBe(true);
      expect(run(ClassWriteController, "handler", method, "COMERCIAL")).toBe(true);
      expect(() => run(ClassWriteController, "handler", method, "TECNICO")).toThrow(ForbiddenException);
      expect(() => run(ClassWriteController, "handler", method, "LEITURA_APENAS")).toThrow(ForbiddenException);
    });

    it("o método sobrepõe a classe", () => {
      expect(run(ClassWriteController, "adminOnlyHandler", "POST", "ADMINISTRADOR")).toBe(true);
      expect(() => run(ClassWriteController, "adminOnlyHandler", "POST", "COMERCIAL")).toThrow(ForbiddenException);
    });

    it("sem utilizador autenticado é recusado", () => {
      expect(() => run(ClassWriteController, "handler", "POST", undefined)).toThrow(ForbiddenException);
    });
  });

  describe("@Roles", () => {
    it("restringe também a leitura", () => {
      expect(run(AdminOnlyController, "handler", "GET", "ADMINISTRADOR")).toBe(true);
      expect(() => run(AdminOnlyController, "handler", "GET", "COMERCIAL")).toThrow(ForbiddenException);
    });

    it("conta como política de escrita", () => {
      expect(run(AdminOnlyController, "handler", "POST", "ADMINISTRADOR")).toBe(true);
      expect(() => run(AdminOnlyController, "handler", "POST", "COMERCIAL")).toThrow(ForbiddenException);
    });
  });

  describe("@WriteArea (configurável, Fase 0d)", () => {
    it("usa os papéis ATUAIS da área, lidos em cada pedido", () => {
      expect(() => run(AreaController, "handler", "POST", "TECNICO")).toThrow(ForbiddenException);
      companies = ["ADMINISTRADOR", "COMERCIAL", "TECNICO"];
      expect(run(AreaController, "handler", "POST", "TECNICO")).toBe(true);
      companies = ["ADMINISTRADOR"];
      expect(() => run(AreaController, "handler", "POST", "COMERCIAL")).toThrow(ForbiddenException);
    });

    it("não afeta a leitura", () => {
      companies = ["ADMINISTRADOR"];
      expect(run(AreaController, "handler", "GET", "TECNICO")).toBe(true);
    });

    it("o que está no método sobrepõe-se à classe, nos dois sentidos", () => {
      companies = ["ADMINISTRADOR", "COMERCIAL", "TECNICO"];
      expect(() => run(AreaController, "fixedHandler", "POST", "TECNICO")).toThrow(ForbiddenException); // fixo no método
      expect(run(FixedClassWithAreaHandler, "handler", "POST", "TECNICO")).toBe(true); // área no método
      expect(() => run(FixedClassWithAreaHandler, "handler", "POST", "FINANCEIRO")).toThrow(ForbiddenException);
    });
  });
});
