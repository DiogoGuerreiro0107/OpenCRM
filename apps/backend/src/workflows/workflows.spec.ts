import { WorkflowOutcome, WorkflowStepCategory } from "@prisma/client";
import { MODULE_IDS } from "../modules/module-manifest";
import { isOpenStep, OPEN_CATEGORIES, STAGE_TYPES, stageTypeOf, stepStateFor } from "./workflow-steps";
import { isWorkflowEntityType, WORKFLOW_ENTITIES, WORKFLOW_ENTITY_TYPES } from "./workflow-registry";

const step = (category: WorkflowStepCategory, outcome: WorkflowOutcome | null = null) => ({ category, outcome });

describe("regras dos passos de fluxo", () => {
  it("aberto = OPEN ou IN_PROGRESS", () => {
    expect(OPEN_CATEGORIES).toEqual(["OPEN", "IN_PROGRESS"]);
    expect(isOpenStep(step("OPEN"))).toBe(true);
    expect(isOpenStep(step("IN_PROGRESS"))).toBe(true);
    expect(isOpenStep(step("DONE", "WON"))).toBe(false);
    expect(isOpenStep(step("CANCELLED"))).toBe(false);
  });

  it("tradução type <-> categoria+resultado (a conversão da migração), nos dois sentidos", () => {
    expect(stepStateFor("OPEN")).toEqual({ category: "OPEN", outcome: null });
    expect(stepStateFor("WON")).toEqual({ category: "DONE", outcome: "WON" });
    expect(stepStateFor("LOST")).toEqual({ category: "DONE", outcome: "LOST" });
    for (const type of STAGE_TYPES) expect(stageTypeOf(stepStateFor(type))).toBe(type);
  });

  it("as categorias novas têm um tipo de negócio coerente com «aberto»", () => {
    expect(stageTypeOf(step("IN_PROGRESS"))).toBe("OPEN");
    expect(stageTypeOf(step("CANCELLED"))).toBe("LOST");
    expect(stageTypeOf(step("DONE"))).toBe("LOST"); // concluído sem resultado: não conta como ganho
    for (const category of Object.values(WorkflowStepCategory)) {
      for (const outcome of [null, ...Object.values(WorkflowOutcome)]) {
        const s = step(category, outcome);
        expect({ category, outcome, coerente: (stageTypeOf(s) === "OPEN") === isOpenStep(s) }).toEqual({ category, outcome, coerente: true });
      }
    }
  });
});

describe("registo de tipos com fluxos", () => {
  it("hoje só negócios, com o identificador DEAL", () => {
    expect(WORKFLOW_ENTITY_TYPES).toEqual(["DEAL"]);
  });

  it("cada tipo tem rótulo, módulo existente (ou núcleo), contagem e mudança de itens", () => {
    for (const [type, entity] of Object.entries(WORKFLOW_ENTITIES)) {
      expect({ type, ok: entity.label.length > 0 && entity.itemName.length > 0 }).toEqual({ type, ok: true });
      expect({ type, ok: entity.module === null || MODULE_IDS.includes(entity.module) }).toEqual({ type, ok: true });
      expect(typeof entity.countItems).toBe("function");
      expect(typeof entity.moveItems).toBe("function");
    }
  });

  it("isWorkflowEntityType só aceita tipos registados", () => {
    expect(isWorkflowEntityType("DEAL")).toBe(true);
    for (const bad of ["deal", "ORDER", "", "toString", "__proto__", null]) expect(isWorkflowEntityType(bad)).toBe(false);
  });
});
