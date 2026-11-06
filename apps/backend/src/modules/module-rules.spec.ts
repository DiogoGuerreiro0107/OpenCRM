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

  it("automações precisam de negócios", () => {
    expect(missingDependencies("automations", set("leads", "email"))).toEqual(["deals"]);
    expect(missingDependencies("automations", set("deals"))).toEqual([]);
  });

  it("um módulo sem dependências nunca tem nada em falta", () => {
    expect(missingDependencies("leads", set())).toEqual([]);
  });

  it("não se desliga negócios enquanto as automações estiverem ativas", () => {
    expect(activeDependents("deals", set("deals", "automations"))).toEqual(["automations"]);
  });

  it("depois de desligar as automações, já se pode desligar os negócios", () => {
    expect(activeDependents("deals", set("deals"))).toEqual([]);
  });

  it("dependentes já desligados não contam", () => {
    expect(activeDependents("deals", set("deals", "leads"))).toEqual([]);
  });
});
