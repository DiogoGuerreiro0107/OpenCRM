import { WorkflowOutcome, WorkflowStepCategory } from "@prisma/client";
import { MODULE_IDS } from "../modules/module-manifest";
import { categoryForStatus, isOpenStatus, statusForCategory } from "../tasks/work-item-status";
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
  it("negócios (DEAL) e tarefas (WORK_ITEM, 2b); só os negócios têm resultado", () => {
    expect(WORKFLOW_ENTITY_TYPES).toEqual(["DEAL", "WORK_ITEM"]);
    expect(WORKFLOW_ENTITIES.DEAL.allowsOutcome).toBe(true);
    expect(WORKFLOW_ENTITIES.WORK_ITEM.allowsOutcome).toBe(false);
  });

  it("cada tipo tem rótulo, módulo existente (ou núcleo), contagem e mudança de itens", () => {
    for (const [type, entity] of Object.entries(WORKFLOW_ENTITIES)) {
      expect({ type, ok: entity.label.length > 0 && entity.itemName.length > 0 }).toEqual({ type, ok: true });
      expect({ type, ok: entity.module === null || MODULE_IDS.includes(entity.module) }).toEqual({ type, ok: true });
      expect(typeof entity.countItems).toBe("function");
      expect(typeof entity.moveItems).toBe("function");
      expect(typeof entity.onStepStateChanged).toBe("function");
      for (const message of Object.values(entity.messages)) {
        const text = typeof message === "function" ? message(3) : message;
        expect({ type, ok: text.length > 0 }).toEqual({ type, ok: true });
      }
    }
  });

  it("isWorkflowEntityType só aceita tipos registados", () => {
    expect(isWorkflowEntityType("DEAL")).toBe(true);
    for (const bad of ["deal", "ORDER", "", "toString", "__proto__", null]) expect(isWorkflowEntityType(bad)).toBe(false);
  });
});

describe("estado das tarefas a partir da categoria do passo (2b)", () => {
  it("OPEN → PENDING; as outras têm o mesmo nome; e o inverso", () => {
    expect(statusForCategory("OPEN")).toBe("PENDING");
    expect(statusForCategory("IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(statusForCategory("DONE")).toBe("DONE");
    expect(statusForCategory("CANCELLED")).toBe("CANCELLED");
    for (const category of Object.values(WorkflowStepCategory)) expect(categoryForStatus(statusForCategory(category))).toBe(category);
  });

  it("um passo «aberto» dá sempre uma tarefa «em aberto» (as listas e a agenda contam pelo estado)", () => {
    for (const category of Object.values(WorkflowStepCategory)) {
      expect({ category, coerente: isOpenStatus(statusForCategory(category)) === isOpenStep(step(category)) }).toEqual({ category, coerente: true });
    }
  });
});
