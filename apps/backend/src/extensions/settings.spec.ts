import { effectiveValue, SettingField, settingFieldsErrors, validateSettingsPatch } from "./settings";

const fields: SettingField[] = [
  { key: "apiKey", label: "API key", type: "text", required: true, maxLength: 10 },
  { key: "apiSecret", label: "API secret", type: "secret", required: true },
  { key: "note", label: "Nota", type: "text" },
  { key: "mode", label: "Modo", type: "select", options: [{ value: "A", label: "A" }, { value: "B", label: "B" }], default: "A" },
  { key: "active", label: "Ativa", type: "boolean", default: true },
];
const errorsOf = (value: unknown, permissions: string[] = ["secrets:own"]) => settingFieldsErrors("«x»", value, permissions);

describe("definições no manifesto", () => {
  it("campos válidos", () => {
    expect(errorsOf(fields)).toEqual([]);
    expect(errorsOf([])).toEqual([]);
  });

  it("forma: lista, objeto, campos desconhecidos, chave, rótulo, tipo", () => {
    expect(errorsOf({})).toEqual(["«x»: settings tem de ser uma lista de campos"]);
    expect(errorsOf([1])).toEqual(["«x»: settings[0] tem de ser um objeto"]);
    expect(errorsOf([{ key: "a", label: "A", type: "text", outro: 1 }])).toEqual(["«x»: settings[0].outro não é um campo de uma definição"]);
    for (const key of ["A", "1a", "a-b", "a_b", "", "a".repeat(41)]) expect(errorsOf([{ key, label: "A", type: "text" }])[0]).toMatch(/key tem de ser um identificador/);
    expect(errorsOf([{ key: "a", label: "A", type: "text" }, { key: "a", label: "B", type: "text" }])).toEqual(["«x»: settings[1].key repete «a»"]);
    expect(errorsOf([{ key: "a", label: " ", type: "text" }])[0]).toMatch(/label tem de ter texto/);
    expect(errorsOf([{ key: "a", label: "A", type: "número" }])).toEqual(["«x»: settings[0].type tem de ser text, secret, select ou boolean"]);
    expect(errorsOf([{ key: "a", label: "A", type: "text", required: "sim" }])[0]).toMatch(/required/);
    expect(errorsOf([{ key: "a", label: "A", type: "text", description: "" }])[0]).toMatch(/description/);
  });

  it("listas: opções obrigatórias, únicas, e o valor por omissão dentro delas", () => {
    expect(errorsOf([{ key: "a", label: "A", type: "select" }])).toEqual(["«x»: settings[0].options tem de ter pelo menos uma opção"]);
    expect(errorsOf([{ key: "a", label: "A", type: "select", options: [] }])[0]).toMatch(/pelo menos uma opção/);
    expect(errorsOf([{ key: "a", label: "A", type: "select", options: [{ value: "x", label: "X" }, { value: "x", label: "Y" }] }])).toEqual(["«x»: settings[0].options repete «x»"]);
    expect(errorsOf([{ key: "a", label: "A", type: "select", options: [{ value: "x" }] }])[0]).toMatch(/options\[0\] tem de ter value e label/);
    expect(errorsOf([{ key: "a", label: "A", type: "select", options: [{ value: "x", label: "X" }], default: "y" }])).toEqual(["«x»: settings[0].default tem de ser uma das opções"]);
    expect(errorsOf([{ key: "a", label: "A", type: "text", options: [{ value: "x", label: "X" }] }])).toEqual(["«x»: settings[0].options só se usa em select"]);
  });

  it("segredos: sem valor por omissão e só com a permissão secrets:own", () => {
    expect(errorsOf([{ key: "s", label: "S", type: "secret", default: "x" }])).toEqual(["«x»: settings[0].default não se usa num segredo"]);
    expect(errorsOf([{ key: "s", label: "S", type: "secret" }], [])).toEqual(["«x»: settings[0]: um segredo exige a permissão secrets:own"]);
  });

  it("valores por omissão do tipo certo e maxLength", () => {
    expect(errorsOf([{ key: "a", label: "A", type: "text", default: true }])).toEqual(["«x»: settings[0].default tem de ser texto"]);
    expect(errorsOf([{ key: "a", label: "A", type: "boolean", default: "sim" }])).toEqual(["«x»: settings[0].default tem de ser verdadeiro ou falso"]);
    expect(errorsOf([{ key: "a", label: "A", type: "text", maxLength: 0 }])[0]).toMatch(/maxLength tem de ser um inteiro/);
    expect(errorsOf([{ key: "a", label: "A", type: "text", maxLength: 5001 }])[0]).toMatch(/maxLength tem de ser um inteiro/);
    expect(errorsOf([{ key: "a", label: "A", type: "boolean", maxLength: 5 }])).toEqual(["«x»: settings[0].maxLength só se usa em text e secret"]);
  });
});

describe("valores das definições", () => {
  it("valores efetivos com os por omissão", () => {
    expect(effectiveValue(fields[3], undefined)).toBe("A");
    expect(effectiveValue(fields[3], "B")).toBe("B");
    expect(effectiveValue(fields[3], "Z")).toBe("A");
    expect(effectiveValue(fields[4], undefined)).toBe(true);
    expect(effectiveValue(fields[4], false)).toBe(false);
    expect(effectiveValue(fields[2], "")).toBeNull();
    expect(effectiveValue(fields[2], "olá")).toBe("olá");
    expect(effectiveValue({ key: "b", label: "B", type: "boolean" }, undefined)).toBe(false);
  });

  it("válido: tipos, aparar texto, apagar opcionais", () => {
    expect(validateSettingsPatch(fields, { apiKey: " k1 ", apiSecret: " s ", note: "", mode: "B", active: false }, {})).toEqual({
      changes: { apiKey: "k1", apiSecret: " s ", note: null, mode: "B", active: false },
      errors: [],
    });
  });

  it("obrigatórios: na primeira gravação, e um segredo já guardado não precisa de vir", () => {
    expect(validateSettingsPatch(fields, { note: "x" }, {}).errors).toEqual(["API key: é obrigatório", "API secret: é obrigatório"]);
    expect(validateSettingsPatch(fields, { note: "x" }, { apiKey: "k", apiSecret: "enc:v1:..." }).errors).toEqual([]);
    expect(validateSettingsPatch(fields, { apiSecret: "" }, { apiKey: "k", apiSecret: "enc" }).errors).toEqual(["API secret: é obrigatório"]);
    expect(validateSettingsPatch(fields, { apiKey: null }, { apiKey: "k", apiSecret: "enc" }).errors).toEqual(["API key: é obrigatório"]);
  });

  it("recusas: desconhecidos, tipos, opções e tamanhos", () => {
    const current = { apiKey: "k", apiSecret: "enc" };
    expect(validateSettingsPatch(fields, [], current).errors).toEqual(["as definições têm de ser um objeto"]);
    expect(validateSettingsPatch(fields, null, current).errors).toEqual(["as definições têm de ser um objeto"]);
    expect(validateSettingsPatch(fields, { outro: 1, constructor: 1, __proto__: 1 } as unknown, current).errors).toEqual(["«outro» não é uma definição desta extensão", "«constructor» não é uma definição desta extensão"]);
    expect(validateSettingsPatch(fields, { active: "sim" }, current).errors).toEqual(["Ativa: tem de ser sim ou não"]);
    expect(validateSettingsPatch(fields, { mode: "Z" }, current).errors).toEqual(["Modo: escolhe uma das opções"]);
    expect(validateSettingsPatch(fields, { note: 3 }, current).errors).toEqual(["Nota: tem de ser texto"]);
    expect(validateSettingsPatch(fields, { apiKey: "x".repeat(11) }, current).errors).toEqual(["API key: no máximo 10 caracteres"]);
    expect(validateSettingsPatch(fields, { note: "x".repeat(501) }, current).errors).toEqual(["Nota: no máximo 500 caracteres"]);
  });
});
