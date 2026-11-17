import { BadRequestException } from "@nestjs/common";
import { CustomFieldType, Prisma, Role } from "@prisma/client";
import { MODULE_IDS } from "../modules/module-manifest";
import { fromValueColumns, FieldForValidation, toValueColumns } from "./custom-field-values";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_ENTITY_TYPES, isCustomFieldEntityType } from "./entity-registry";

const field = (fieldType: CustomFieldType, extra: Partial<FieldForValidation> = {}): FieldForValidation => ({
  fieldLabel: "Campo X",
  fieldType,
  options: null,
  isRequired: false,
  ...extra,
});

const accepts = (f: FieldForValidation, value: unknown) => toValueColumns(f, value);
const rejects = (f: FieldForValidation, value: unknown) => {
  expect(() => toValueColumns(f, value)).toThrow(BadRequestException);
  try {
    toValueColumns(f, value);
  } catch (err) {
    expect((err as Error).message).toContain("«Campo X»"); // diz qual campo falhou
  }
};

describe("validação dos valores por tipo de campo", () => {
  it("vazio grava tudo a null; num campo obrigatório é recusado", () => {
    for (const empty of [null, undefined, "", "   ", []]) {
      expect(accepts(field("TEXT"), empty)).toMatchObject({ valueText: null, valueNumber: null, valueDate: null, valueBoolean: null });
      rejects(field("TEXT", { isRequired: true }), empty);
    }
  });

  it("número e moeda: números e texto numérico; recusa texto, infinito e NaN", () => {
    expect(accepts(field("NUMBER"), 42).valueNumber).toBe(42);
    expect(accepts(field("CURRENCY"), "1500.50").valueNumber).toBe(1500.5);
    expect(accepts(field("NUMBER"), -3).valueNumber).toBe(-3);
    for (const bad of ["abc", "12abc", "1e999", Infinity, NaN, true, {}, ["1"]]) rejects(field("NUMBER"), bad);
  });

  it("data: AAAA-MM-DD ou ISO; recusa datas impossíveis e lixo", () => {
    expect(accepts(field("DATE"), "2026-11-17").valueDate?.toISOString()).toBe("2026-11-17T00:00:00.000Z");
    expect(accepts(field("DATE"), "2026-11-17T10:30:00.000Z").valueDate?.toISOString()).toBe("2026-11-17T10:30:00.000Z");
    for (const bad of ["2026-02-30", "2026-13-01", "ontem", 20261117, true]) rejects(field("DATE"), bad);
  });

  it("sim/não: só booleanos", () => {
    expect(accepts(field("BOOLEAN"), true).valueBoolean).toBe(true);
    expect(accepts(field("BOOLEAN"), false).valueBoolean).toBe(false);
    for (const bad of ["true", 1, "sim"]) rejects(field("BOOLEAN"), bad);
  });

  it("lista: só uma das opções", () => {
    const f = field("SELECT", { options: ["Ouro", "Prata"] });
    expect(accepts(f, "Ouro").valueText).toBe("Ouro");
    for (const bad of ["Bronze", "ouro", ["Ouro"], 1]) rejects(f, bad);
  });

  it("seleção múltipla: lista de opções existentes, sem repetições", () => {
    const f = field("MULTISELECT", { options: ["A", "B", "C"] });
    expect(accepts(f, ["A", "C"]).valueJson).toEqual(["A", "C"]);
    expect(accepts(f, []).valueJson).toBe(Prisma.JsonNull); // vazio
    for (const bad of [["A", "Z"], ["A", "A"], "A", [1], [null]]) rejects(f, bad);
  });

  it("email, URL e telefone", () => {
    expect(accepts(field("EMAIL"), " ana@acme.pt ").valueText).toBe("ana@acme.pt");
    for (const bad of ["ana", "ana@", "a b@c.pt"]) rejects(field("EMAIL"), bad);
    expect(accepts(field("URL"), "https://acme.pt/x").valueText).toBe("https://acme.pt/x");
    for (const bad of ["acme.pt", "ftp://acme.pt", "javascript:alert(1)"]) rejects(field("URL"), bad);
    expect(accepts(field("PHONE"), "+351 912 345 678").valueText).toBe("+351 912 345 678");
    for (const bad of ["liga-me", "<script>"]) rejects(field("PHONE"), bad);
  });

  it("texto: aceita números como texto; limita o tamanho; recusa objetos", () => {
    expect(accepts(field("TEXT"), 123).valueText).toBe("123");
    expect(accepts(field("TEXTAREA"), "a".repeat(5000)).valueText).toHaveLength(5000);
    rejects(field("TEXTAREA"), "a".repeat(5001));
    rejects(field("TEXT"), { a: 1 });
  });

  it("ida e volta: o que se grava lê-se igual", () => {
    const cases: Array<[CustomFieldType, unknown, Partial<FieldForValidation>?]> = [
      ["NUMBER", 7],
      ["BOOLEAN", false],
      ["SELECT", "Ouro", { options: ["Ouro"] }],
      ["MULTISELECT", ["A"], { options: ["A"] }],
      ["TEXT", "olá"],
    ];
    for (const [type, value, extra] of cases) {
      const cols = toValueColumns(field(type, extra), value);
      const stored = { ...cols, valueJson: cols.valueJson === Prisma.JsonNull ? null : (cols.valueJson as Prisma.JsonValue) };
      expect(fromValueColumns(type, stored)).toEqual(value);
    }
  });
});

describe("registo de tipos de registo com campos personalizados", () => {
  it("tem os quatro tipos atuais, com os MESMOS identificadores de antes (não muda nada para quem usa)", () => {
    expect([...CUSTOM_FIELD_ENTITY_TYPES].sort()).toEqual(["COMPANY", "CONTACT", "DEAL", "LEAD"]);
  });

  it("cada tipo tem rótulo, módulo existente (ou núcleo), permissões e verificação de existência", () => {
    const roles = Object.values(Role) as string[];
    for (const [type, entity] of Object.entries(CUSTOM_FIELD_ENTITIES)) {
      expect({ type, ok: entity.label.length > 0 }).toEqual({ type, ok: true });
      expect({ type, ok: entity.module === null || MODULE_IDS.includes(entity.module) }).toEqual({ type, ok: true });
      expect(entity.writeRoles.length).toBeGreaterThan(0);
      for (const role of entity.writeRoles) expect(roles).toContain(role);
      expect(entity.writeRoles).not.toContain("LEITURA_APENAS");
      expect(typeof entity.exists).toBe("function");
    }
  });

  it("isCustomFieldEntityType só aceita tipos registados (sem truques com o protótipo)", () => {
    expect(isCustomFieldEntityType("COMPANY")).toBe(true);
    for (const bad of ["company", "ORDER", "", "toString", "__proto__", 1, null]) expect(isCustomFieldEntityType(bad)).toBe(false);
  });
});
