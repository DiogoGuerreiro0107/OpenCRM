import { MODULE_IDS } from "../../modules/module-manifest";
import { WORKFLOW_ENTITY_TYPES } from "../../workflows/workflow-registry";
import { AUTOMATION_ENTITIES, AUTOMATION_ENTITY_TYPES, isAutomationEntityType } from "./automation-entities";
import { AUTOMATION_TRIGGERS, isAutomationTriggerId } from "./automation-triggers";
import { AUTOMATION_ACTIONS, isAutomationActionId } from "./automation-actions";
import { AutomationField, OPERATORS_BY_KIND, firstFailing, normalizeConditions } from "./conditions";
import { EngineDeps, EngineRule, MAX_CHAIN_DEPTH, RunRecord, newChain, runEvent, runRule } from "./engine";

describe("registos das automações (3a)", () => {
  it("cada tipo de registo tem rótulo, módulo existente, fluxo registado e campos coerentes", () => {
    for (const [type, entity] of Object.entries(AUTOMATION_ENTITIES)) {
      expect({ type, ok: entity.label.length > 0 && typeof entity.load === "function" }).toEqual({ type, ok: true });
      expect({ type, ok: entity.module === null || MODULE_IDS.includes(entity.module) }).toEqual({ type, ok: true });
      expect({ type, ok: entity.workflowEntity === null || WORKFLOW_ENTITY_TYPES.includes(entity.workflowEntity) }).toEqual({ type, ok: true });
      const names = entity.fields.map((f) => f.name);
      expect({ type, unique: new Set(names).size === names.length }).toEqual({ type, unique: true });
      for (const tracked of entity.changeTracked) expect({ type, tracked, ok: names.includes(tracked) }).toEqual({ type, tracked, ok: true });
      for (const f of entity.fields) if (f.kind === "option") expect({ type, field: f.name, ok: (f.options?.length ?? 0) > 0 }).toEqual({ type, field: f.name, ok: true });
    }
  });

  it("gatilhos e ações só apontam para tipos de registo que existem; os agendados sabem procurar", () => {
    for (const [id, trigger] of Object.entries(AUTOMATION_TRIGGERS)) {
      expect({ id, ok: trigger.label.length > 0 && trigger.entities.length > 0 && trigger.entities.every(isAutomationEntityType) }).toEqual({ id, ok: true });
      expect({ id, ok: !trigger.scheduled || typeof (trigger as { findDue?: unknown }).findDue === "function" }).toEqual({ id, ok: true });
    }
    for (const [id, action] of Object.entries(AUTOMATION_ACTIONS)) {
      expect({ id, ok: action.label.length > 0 && (action.entities === null || action.entities.every(isAutomationEntityType)) }).toEqual({ id, ok: true });
    }
  });

  it("os códigos das regras convertidas pela migração existem", () => {
    for (const t of ["IDLE_IN_STEP", "ALL_TASKS_CLOSED", "FIELD_CHANGED"]) expect(isAutomationTriggerId(t)).toBe(true);
    for (const a of ["MOVE_TO_STEP", "WEBHOOK"]) expect(isAutomationActionId(a)).toBe(true);
    expect(AUTOMATION_ENTITY_TYPES).toContain("DEAL");
    for (const bad of ["deal", "", "toString", "__proto__", null]) {
      expect(isAutomationEntityType(bad)).toBe(false);
      expect(isAutomationTriggerId(bad)).toBe(false);
      expect(isAutomationActionId(bad)).toBe(false);
    }
  });
});

const FIELDS: AutomationField[] = [
  { name: "value", label: "Valor", kind: "number" },
  { name: "type", label: "Tipo", kind: "option", options: [{ value: "POS", label: "POS" }] },
  { name: "ownerId", label: "Responsável", kind: "user" },
];

describe("condições", () => {
  it("valida campo, operador por tipo de campo e valor", () => {
    expect(normalizeConditions(FIELDS, [{ field: "value", operator: "gt", value: 10, extra: 1 }])).toEqual([{ field: "value", operator: "gt", value: 10 }]);
    expect(normalizeConditions(FIELDS, [{ field: "type", operator: "empty", value: "x" }])).toEqual([{ field: "type", operator: "empty" }]);
    expect(normalizeConditions(FIELDS, undefined)).toEqual([]);
    expect(() => normalizeConditions(FIELDS, [{ field: "nope", operator: "eq", value: 1 }])).toThrow(/campo desconhecido/);
    expect(() => normalizeConditions(FIELDS, [{ field: "type", operator: "gt", value: "POS" }])).toThrow(/operador/);
    expect(() => normalizeConditions(FIELDS, [{ field: "value", operator: "gt", value: "10" }])).toThrow(/número/);
    expect(() => normalizeConditions(FIELDS, [{ field: "type", operator: "eq", value: "XPTO" }])).toThrow(/opção/);
    expect(() => normalizeConditions(FIELDS, [{ field: "ownerId", operator: "eq", value: " " }])).toThrow(/falta o valor/);
    expect(() => normalizeConditions(FIELDS, "x")).toThrow(/lista/);
    expect(() => normalizeConditions(FIELDS, Array(11).fill({ field: "value", operator: "empty" }))).toThrow(/No máximo/);
    for (const ops of Object.values(OPERATORS_BY_KIND)) expect(ops.length).toBeGreaterThan(0);
  });

  it("avalia todas (e) e diz qual falhou; números só comparam com números", () => {
    const conditions = normalizeConditions(FIELDS, [
      { field: "value", operator: "gte", value: 100 },
      { field: "type", operator: "eq", value: "POS" },
    ]);
    expect(firstFailing(FIELDS, { value: 100, type: "POS" }, conditions)).toBeNull();
    expect(firstFailing(FIELDS, { value: 99, type: "POS" }, conditions)).toMatch(/Valor/);
    expect(firstFailing(FIELDS, { value: 100, type: null }, conditions)).toMatch(/Tipo/);
    expect(firstFailing(FIELDS, { value: null }, [{ field: "value", operator: "lt", value: 5 }])).toMatch(/Valor/);
    // Limites: «maior que» e «menor que» são estritos; os «ou igual» incluem o próprio valor.
    expect(firstFailing(FIELDS, { value: 10 }, [{ field: "value", operator: "gt", value: 10 }])).toMatch(/Valor/);
    expect(firstFailing(FIELDS, { value: 10 }, [{ field: "value", operator: "lt", value: 10 }])).toMatch(/Valor/);
    expect(firstFailing(FIELDS, { value: 10 }, [{ field: "value", operator: "lte", value: 10 }])).toBeNull();
    expect(firstFailing(FIELDS, { value: 10 }, [{ field: "value", operator: "eq", value: 10 }])).toBeNull();
    expect(firstFailing(FIELDS, { value: null }, [{ field: "value", operator: "empty" }])).toBeNull();
    expect(firstFailing(FIELDS, { ownerId: "u1" }, [{ field: "ownerId", operator: "neq", value: "u2" }])).toBeNull();
  });
});

describe("motor", () => {
  const rule = (over: Partial<EngineRule> = {}): EngineRule => ({
    id: "r1", name: "Regra", entityType: "DEAL", workflowId: null, stepId: null, trigger: "T", triggerConfig: {}, conditions: [], action: "A", actionConfig: {}, ...over,
  });
  const record = { values: { value: 50 }, workflowId: "w1", stepId: "s1" };
  const event = { entityType: "DEAL", entityId: "d1", trigger: "T" };

  function deps(over: Partial<EngineDeps> = {}) {
    const runs: RunRecord[] = [];
    const d: EngineDeps = {
      rulesFor: async () => [rule()],
      load: async () => record,
      fields: () => FIELDS,
      matches: async () => true,
      execute: async () => "feito",
      log: async (r) => {
        runs.push(r);
      },
      ...over,
    };
    return { d, runs };
  }

  it("executa e regista; fora do âmbito ou sem o gatilho não regista nada", async () => {
    const { d, runs } = deps();
    await runRule(d, rule(), event, record, newChain(), true);
    expect(runs).toEqual([expect.objectContaining({ outcome: "SUCCEEDED", message: "feito", depth: 0 })]);
    await runRule(d, rule({ workflowId: "outro" }), event, record, newChain(), true);
    await runRule(d, rule({ stepId: "outro" }), event, record, newChain(), true);
    await runRule({ ...d, matches: async () => false }, rule(), event, record, newChain(), true);
    expect(runs).toHaveLength(1);
  });

  it("condição não cumprida: ignorada com motivo (ou sem registo nos agendados)", async () => {
    const { d, runs } = deps();
    const r = rule({ conditions: [{ field: "value", operator: "gt", value: 100 }] });
    await runRule(d, r, event, record, newChain(), true);
    await runRule(d, r, event, record, newChain(), false);
    expect(runs).toEqual([expect.objectContaining({ outcome: "SKIPPED", message: expect.stringMatching(/Valor/) })]);
  });

  it("uma falha na ação fica registada e não se propaga", async () => {
    const { d, runs } = deps({ execute: async () => { throw new Error("rebentou"); } });
    await expect(runRule(d, rule(), event, record, newChain(), true)).resolves.toBeUndefined();
    expect(runs).toEqual([expect.objectContaining({ outcome: "FAILED", message: "rebentou" })]);
  });

  it("ciclos: uma regra que se volta a disparar corre uma vez; cadeias longas param", async () => {
    // A ação despacha o mesmo evento outra vez (como «mover» → «entrou no passo» → «mover»...).
    let calls = 0;
    const { d, runs } = deps();
    d.execute = async (_r, ev, chain) => {
      calls++;
      await runEvent(d, ev, { depth: chain.depth + 1, seen: chain.seen });
      return "feito";
    };
    await runEvent(d, event);
    expect(calls).toBe(1);
    expect(runs.map((r) => [r.outcome, r.depth])).toEqual([["SKIPPED", 1], ["SUCCEEDED", 0]]);

    // Regras diferentes em cadeia: param ao passar a profundidade máxima.
    let n = 0;
    const chainDeps = deps();
    chainDeps.d.rulesFor = async () => [rule({ id: `r${n++}` })];
    chainDeps.d.execute = async (_r, ev, chain) => {
      await runEvent(chainDeps.d, ev, { depth: chain.depth + 1, seen: chain.seen });
      return "feito";
    };
    await runEvent(chainDeps.d, event);
    expect(chainDeps.runs.filter((r) => r.outcome === "SUCCEEDED")).toHaveLength(MAX_CHAIN_DEPTH + 1);
    expect(chainDeps.runs[0]).toMatchObject({ outcome: "SKIPPED", depth: MAX_CHAIN_DEPTH + 1, message: expect.stringMatching(/demasiado longa/) });
  });

  it("registo que já não existe: nada corre", async () => {
    const { d, runs } = deps({ load: async () => null });
    await runEvent(d, event);
    expect(runs).toEqual([]);
  });
});
