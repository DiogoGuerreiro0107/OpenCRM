import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";

function contextFor(method: string, originalUrl: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, originalUrl }) }),
  } as unknown as ExecutionContext;
}

describe("JwtAuthGuard.handleRequest", () => {
  const guard = new JwtAuthGuard();
  const user = (role: string) => ({ userId: "u1", email: "u@x.pt", role });

  it("sem utilizador lança Unauthorized", () => {
    expect(() => guard.handleRequest(null, null, null, contextFor("GET", "/companies"))).toThrow(UnauthorizedException);
  });

  it("propaga o erro original do passport", () => {
    const err = new Error("token expirado");
    expect(() => guard.handleRequest(err, null, null, contextFor("GET", "/companies"))).toThrow(err);
  });

  it("devolve o utilizador num pedido de leitura", () => {
    expect(guard.handleRequest(null, user("LEITURA_APENAS"), null, contextFor("GET", "/companies"))).toEqual(
      user("LEITURA_APENAS"),
    );
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])("LEITURA_APENAS não pode fazer %s", (method) => {
    expect(() => guard.handleRequest(null, user("LEITURA_APENAS"), null, contextFor(method, "/companies"))).toThrow(
      ForbiddenException,
    );
  });

  it("LEITURA_APENAS pode usar as rotas /auth (ex.: terminar sessão)", () => {
    expect(guard.handleRequest(null, user("LEITURA_APENAS"), null, contextFor("POST", "/auth/logout"))).toBeTruthy();
  });

  it("outros papéis escrevem (a decisão fina é do RolesGuard)", () => {
    expect(guard.handleRequest(null, user("TECNICO"), null, contextFor("POST", "/tasks"))).toBeTruthy();
  });
});
