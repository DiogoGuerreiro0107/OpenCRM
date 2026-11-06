import { CallHandler, ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { RealtimeInterceptor, resourceOf } from "./realtime.interceptor";

describe("resourceOf", () => {
  it.each([
    ["/deals", "deals"],
    ["/deals/123/move", "deals"],
    ["/deals?pipelineId=1", "deals"],
    ["/tasks/abc", "tasks"],
    ["/custom-fields/values", "custom-fields"],
    ["/email/ingest", "email"],
    ["/stages/abc", "pipelines"], // as fases são mostradas no Kanban, tal como os funis
    ["/pipelines/1/stages", "pipelines"],
  ])("%s -> %s", (url, resource) => {
    expect(resourceOf(url)).toBe(resource);
  });

  it.each(["/auth/login", "/auth/change-password", "/auth/refresh", "/", ""])("%j não é um recurso do CRM", (url) => {
    expect(resourceOf(url)).toBeNull();
  });
});

describe("RealtimeInterceptor", () => {
  const contextFor = (method: string, originalUrl: string) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ method, originalUrl }) }) }) as unknown as ExecutionContext;

  function run(method: string, url: string, handler: CallHandler) {
    const realtime = { emit: jest.fn() };
    const interceptor = new RealtimeInterceptor(realtime as never);
    return { realtime, result: interceptor.intercept(contextFor(method, url), handler) };
  }

  it.each(["POST", "PATCH", "PUT", "DELETE"])("%s bem-sucedido emite { recurso, ação }", async (method) => {
    const { realtime, result } = run(method, "/deals/1", { handle: () => of("ok") });
    await lastValueFrom(result);
    expect(realtime.emit).toHaveBeenCalledWith("deals", method);
  });

  it("leituras (GET) nunca emitem", async () => {
    const { realtime, result } = run("GET", "/deals", { handle: () => of("ok") });
    await lastValueFrom(result);
    expect(realtime.emit).not.toHaveBeenCalled();
  });

  it("um pedido que falhou NÃO emite (nada mudou)", async () => {
    const { realtime, result } = run("POST", "/deals", { handle: () => throwError(() => new Error("falhou")) });
    await expect(lastValueFrom(result)).rejects.toThrow("falhou");
    expect(realtime.emit).not.toHaveBeenCalled();
  });

  it("rotas /auth não emitem", async () => {
    const { realtime, result } = run("POST", "/auth/login", { handle: () => of("ok") });
    await lastValueFrom(result);
    expect(realtime.emit).not.toHaveBeenCalled();
  });

  it("a resposta passa intacta (o interceptor não altera o resultado)", async () => {
    const { result } = run("POST", "/deals", { handle: () => of({ id: "x", segredo: 1 }) });
    await expect(lastValueFrom(result)).resolves.toEqual({ id: "x", segredo: 1 });
  });
});
