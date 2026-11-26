import { MODULE_MANIFESTS, isModuleId } from "../modules/module-manifest";
import { BUILTIN_EXTENSIONS } from "./builtin";
import { ExtensionManifest, SDK_VERSION, manifestErrors, manifestSetErrors } from "./manifest";
import { describePermission, isPermission } from "./permissions";
import { isRange, isVersion, satisfies } from "./semver";

const valid = (over: Partial<ExtensionManifest> = {}): ExtensionManifest => ({
  id: "faturacao-exemplo",
  name: "Faturação — Exemplo",
  description: "Envia as encomendas para o programa de faturação.",
  version: "1.2.0",
  sdk: "^1.0.0",
  origin: "installed",
  dependsOn: {},
  provides: [],
  permissions: ["net:egress:api.exemplo.pt", "secrets:own"],
  defaultEnabled: false,
  ...over,
});

describe("semver (formatos dos manifestos)", () => {
  it("versões: só x.y.z sem zeros à esquerda nem pré-lançamentos", () => {
    expect(["0.0.0", "1.2.3", "10.20.30"].every(isVersion)).toBe(true);
    expect(["1.2", "1.2.3.4", "01.2.3", "1.02.3", "v1.2.3", "1.2.3-beta", "", " 1.2.3", "1.2.x"].some(isVersion)).toBe(false);
  });

  it("intervalos aceites e recusados", () => {
    expect(["*", "1.2.3", "^1.2.3", "~1.2.3", ">=1.2.3"].every(isRange)).toBe(true);
    expect(["^1.2", "<2.0.0", ">1.0.0", "1.x", "^ 1.2.3", "latest", "", "1.2.3 || 2.0.0"].some(isRange)).toBe(false);
  });

  it.each([
    ["1.2.3", "*", true],
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.2.3", "^1.2.3", true],
    ["1.9.0", "^1.2.3", true],
    ["2.0.0", "^1.2.3", false],
    ["1.2.2", "^1.2.3", false],
    ["0.2.5", "^0.2.3", true],
    ["0.3.0", "^0.2.3", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["1.2.9", "~1.2.3", true],
    ["1.3.0", "~1.2.3", false],
    ["1.2.2", "~1.2.3", false],
    ["9.0.0", ">=1.2.3", true],
    ["1.2.2", ">=1.2.3", false],
    ["1.2", "*", false],
    ["1.2.3", "^1.2", false],
  ])("%s em %s → %s", (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
});

describe("permissões declaradas", () => {
  it("descreve o vocabulário em português", () => {
    expect(describePermission("data:orders:write")).toBe("Altera dados: Encomendas");
    expect(describePermission("net:egress:api.zadarma.com")).toBe("Liga-se a api.zadarma.com");
    expect(describePermission("secrets:own")).toMatch(/cifrados/);
    expect(isPermission("net:egress:configured")).toBe(true);
    expect(isPermission("webhooks:emit")).toBe(true);
    expect(isPermission("jobs:schedule")).toBe(true);
  });

  it("recusa o que não é do vocabulário", () => {
    for (const p of ["data:nada:write", "data:orders:read", "net:egress:", "net:egress:localhost", "net:egress:http://x.pt", "net:egress:EXEMPLO.PT", "secrets", "admin", "", "data:__proto__:write", "data:constructor:write"]) {
      expect({ p, ok: isPermission(p) }).toEqual({ p, ok: false });
    }
  });
});

describe("manifesto de uma extensão", () => {
  it("um manifesto completo é válido", () => {
    expect(manifestErrors(valid())).toEqual([]);
  });

  it("campos em falta e desconhecidos", () => {
    const { version: _v, ...noVersion } = valid();
    expect(manifestErrors(noVersion)).toEqual(["«faturacao-exemplo»: version é obrigatório"]);
    expect(manifestErrors({ ...valid(), server: "dist/index.js" })).toEqual(["«faturacao-exemplo»: server não é um campo do manifesto"]);
    expect(manifestErrors(null)).toEqual(["o manifesto tem de ser um objeto"]);
    expect(manifestErrors([valid()])).toEqual(["o manifesto tem de ser um objeto"]);
  });

  it("formatos: id, textos, versão, origem, ativo por omissão", () => {
    expect(manifestErrors(valid({ id: "Faturação" }))[0]).toMatch(/id tem de ter minúsculas/);
    expect(manifestErrors(valid({ id: "-x" }))[0]).toMatch(/id tem de ter/);
    for (const id of ["Faturacao", "faturacaoX", "a--b", "a-", "1a", "a_b"]) expect(manifestErrors(valid({ id }))[0]).toMatch(/id tem de ter/);
    for (const id of ["a", "a1", "a-1", "faturacao-exemplo-2"]) expect(manifestErrors(valid({ id }))).toEqual([]);
    expect(manifestErrors(valid({ id: "a".repeat(51) }))[0]).toMatch(/id tem de ter/);
    expect(manifestErrors(valid({ name: "  " }))).toEqual(["«faturacao-exemplo»: name tem de ter texto (até 80 caracteres)"]);
    expect(manifestErrors(valid({ description: "x".repeat(501) }))[0]).toMatch(/description/);
    expect(manifestErrors(valid({ version: "1.0" }))).toEqual(["«faturacao-exemplo»: version tem de ser uma versão como 1.2.3"]);
    expect(manifestErrors(valid({ origin: "outra" as never }))[0]).toMatch(/origin/);
    expect(manifestErrors(valid({ defaultEnabled: "sim" as never }))[0]).toMatch(/defaultEnabled/);
  });

  it("o SDK tem de aceitar a versão do núcleo", () => {
    expect(SDK_VERSION).toBe("1.0.0");
    expect(manifestErrors(valid({ sdk: "^2.0.0" }))).toEqual([`«faturacao-exemplo»: sdk «^2.0.0» não aceita a versão do núcleo (${SDK_VERSION})`]);
    expect(manifestErrors(valid({ sdk: "1.x" }))[0]).toMatch(/sdk tem de ser um intervalo/);
    expect(manifestErrors(valid({ sdk: ">=1.0.0" }))).toEqual([]);
  });

  it("dependências, contratos e permissões", () => {
    expect(manifestErrors(valid({ dependsOn: { encomendas: "^1.0.0" } }))).toEqual([]);
    expect(manifestErrors(valid({ dependsOn: { encomendas: "latest" } }))[0]).toMatch(/dependsOn.encomendas tem de ser um intervalo/);
    expect(manifestErrors(valid({ dependsOn: { "faturacao-exemplo": "*" } }))[0]).toMatch(/não pode depender de si própria/);
    expect(manifestErrors(valid({ dependsOn: ["encomendas"] as never }))[0]).toMatch(/dependsOn tem de ser um objeto/);
    expect(manifestErrors(valid({ provides: ["billing"] }))).toEqual(["«faturacao-exemplo»: provides «billing» não é um contrato conhecido"]);
    expect(manifestErrors(valid({ permissions: ["secrets:own", "root"] }))).toEqual(["«faturacao-exemplo»: permissions «root» não é uma permissão conhecida"]);
    expect(manifestErrors(valid({ permissions: ["secrets:own", "secrets:own"] }))).toEqual(["«faturacao-exemplo»: permissions repete «secrets:own»"]);
    expect(manifestErrors(valid({ permissions: "secrets:own" as never }))[0]).toMatch(/permissions tem de ser uma lista/);
  });
});

describe("conjunto de manifestos", () => {
  const a = valid({ id: "a", version: "1.0.0" });
  it("válido com dependências satisfeitas", () => {
    expect(manifestSetErrors([a, valid({ id: "b", dependsOn: { a: "^1.0.0" } })])).toEqual([]);
  });

  it("ids repetidos, dependência inexistente ou na versão errada", () => {
    expect(manifestSetErrors([a, a])).toEqual(["«a»: id repetido"]);
    expect(manifestSetErrors([valid({ id: "b", dependsOn: { nada: "*" } })])).toEqual(["«b»: depende de «nada», que não existe"]);
    expect(manifestSetErrors([a, valid({ id: "b", dependsOn: { a: "^2.0.0" } })])).toEqual(["«b»: precisa de «a» ^2.0.0, e há a 1.0.0"]);
  });

  it("ciclos", () => {
    const errors = manifestSetErrors([valid({ id: "a", dependsOn: { c: "*" } }), valid({ id: "b", dependsOn: { a: "*" } }), valid({ id: "c", dependsOn: { b: "*" } })]);
    expect(errors).toEqual(["dependências em ciclo: a → c → b → a"]);
  });

  it("um manifesto inválido no conjunto aparece com o seu erro", () => {
    expect(manifestSetErrors([a, { ...valid({ id: "b" }), version: "x" }])).toEqual(["«b»: version tem de ser uma versão como 1.2.3"]);
  });
});

describe("extensões embutidas (os módulos)", () => {
  it("são válidas como conjunto (o backend recusa arrancar se não forem)", () => {
    expect(manifestSetErrors(BUILTIN_EXTENSIONS)).toEqual([]);
  });

  it("uma por módulo, com o mesmo id, nome, dependências e ativo por omissão", () => {
    expect(BUILTIN_EXTENSIONS.map((e) => e.id)).toEqual(MODULE_MANIFESTS.map((m) => m.id));
    for (const e of BUILTIN_EXTENSIONS) {
      const m = MODULE_MANIFESTS.find((x) => x.id === e.id)!;
      expect(isModuleId(e.id)).toBe(true);
      expect(e).toMatchObject({ name: m.label, description: m.description, origin: "builtin", version: SDK_VERSION, defaultEnabled: m.defaultEnabled, permissions: m.permissions });
      expect(Object.keys(e.dependsOn)).toEqual(m.dependsOn);
    }
  });

  it("declaram o que fazem: quem fala com fora e quem guarda segredos", () => {
    const perms = (id: string) => BUILTIN_EXTENSIONS.find((e) => e.id === id)!.permissions;
    expect(perms("zadarma")).toEqual(expect.arrayContaining(["net:egress:api.zadarma.com", "secrets:own", "jobs:schedule"]));
    expect(perms("email")).toEqual(expect.arrayContaining(["net:egress:configured", "secrets:own"]));
    expect(perms("encomendas")).toEqual(expect.arrayContaining(["data:orders:write", "webhooks:emit"]));
    // Só a Zadarma e o email guardam segredos.
    expect(BUILTIN_EXTENSIONS.filter((e) => e.permissions.includes("secrets:own")).map((e) => e.id).sort()).toEqual(["email", "zadarma"]);
  });
});
