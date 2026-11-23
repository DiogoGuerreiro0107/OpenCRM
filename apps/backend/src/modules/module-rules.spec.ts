import { MODULE_MANIFESTS, ModuleManifest, isModuleId } from "./module-manifest";
import { activeDependents, manifestProblems, missingDependencies } from "./module-rules";

const m = (id: string, dependsOn: string[] = []): ModuleManifest =>
  ({ id, label: id, description: "", dependsOn, defaultEnabled: true }) as unknown as ModuleManifest;

describe("manifestos reais", () => {
  it("não têm problemas (ids repetidos, dependências inexistentes ou em ciclo)", () => {
    expect(manifestProblems()).toEqual([]);
  });

  it("todos estão ativos por omissão (instalar a funcionalidade não muda o comportamento de ninguém)", () => {
    expect(MODULE_MANIFESTS.filter((x) => !x.defaultEnabled).map((x) => x.id)).toEqual([]);
  });

  it("cada módulo tem etiqueta e descrição", () => {
    for (const manifest of MODULE_MANIFESTS) {
      expect(manifest.label.trim()).not.toBe("");
      expect(manifest.description.trim()).not.toBe("");
    }
  });

  it("isModuleId só aceita módulos que existem", () => {
    expect(isModuleId("leads")).toBe(true);
    expect(isModuleId("automations")).toBe(true);
    expect(isModuleId("nao-existe")).toBe(false);
    expect(isModuleId("")).toBe(false);
    expect(isModuleId("__proto__")).toBe(false);
  });
});

describe("manifestProblems (deteta manifestos maus)", () => {
  it("dependência para um módulo que não existe", () => {
    expect(manifestProblems([m("a", ["fantasma"])]).join(" ")).toContain("fantasma");
  });

  it("módulo que depende de si próprio", () => {
    expect(manifestProblems([m("a", ["a"])]).join(" ")).toContain("si próprio");
  });

  it("ciclo entre dois e entre três módulos", () => {
    expect(manifestProblems([m("a", ["b"]), m("b", ["a"])]).join(" ")).toContain("ciclo");
    expect(manifestProblems([m("a", ["b"]), m("b", ["c"]), m("c", ["a"])]).join(" ")).toContain("ciclo");
  });

  it("ids repetidos", () => {
    expect(manifestProblems([m("a"), m("a")]).join(" ")).toContain("repetido");
  });

  it("uma cadeia sem ciclo é válida", () => {
    expect(manifestProblems([m("a"), m("b", ["a"]), m("c", ["b"])])).toEqual([]);
  });
});

describe("dependências", () => {
  const set = (...ids: string[]) => new Set(ids) as never;
  // Desde a 3b nenhum módulo real tem dependências: o mecanismo testa-se com manifestos de teste.
  const manifests = [m("deals"), m("leads"), m("automations", ["deals"])];

  it("um módulo com dependência desligada não se liga", () => {
    expect(missingDependencies("automations", set("leads", "email"), manifests)).toEqual(["deals"]);
    expect(missingDependencies("automations", set("deals"), manifests)).toEqual([]);
  });

  it("um módulo sem dependências nunca tem nada em falta", () => {
    expect(missingDependencies("leads", set(), manifests)).toEqual([]);
  });

  it("não se desliga uma dependência enquanto o dependente estiver ativo", () => {
    expect(activeDependents("deals", set("deals", "automations"), manifests)).toEqual(["automations"]);
  });

  it("depois de desligar o dependente, já se pode desligar a dependência", () => {
    expect(activeDependents("deals", set("deals"), manifests)).toEqual([]);
  });

  it("dependentes já desligados não contam", () => {
    expect(activeDependents("deals", set("deals", "leads"), manifests)).toEqual([]);
  });

  it("só o stock depende de outro módulo (dos produtos, Fase 5b); desde a 3b as automações correm por tipo de registo", () => {
    expect(MODULE_MANIFESTS.filter((x) => x.dependsOn.length > 0).map((x) => [x.id, x.dependsOn])).toEqual([["stock", ["produtos"]]]);
  });
});
