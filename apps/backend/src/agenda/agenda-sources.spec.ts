import { MODULE_IDS } from "../modules/module-manifest";
import { AGENDA_SOURCE_IDS, AGENDA_SOURCES, isAgendaSourceId } from "./agenda-sources";
import { dayIn, isTimeZone } from "../common/time-zone";

describe("registo de fontes da agenda (2d)", () => {
  it("tarefas (núcleo) e próxima ação das leads (módulo leads)", () => {
    expect(AGENDA_SOURCE_IDS).toEqual(["WORK_ITEM", "LEAD_NEXT_ACTION"]);
    expect(AGENDA_SOURCES.WORK_ITEM.module).toBeNull();
    expect(AGENDA_SOURCES.LEAD_NEXT_ACTION.module).toBe("leads");
  });

  it("cada fonte tem rótulo, módulo existente (ou núcleo) e leitura", () => {
    for (const [id, source] of Object.entries(AGENDA_SOURCES)) {
      expect({ id, ok: source.label.length > 0 && typeof source.fetch === "function" }).toEqual({ id, ok: true });
      expect({ id, ok: source.module === null || MODULE_IDS.includes(source.module) }).toEqual({ id, ok: true });
    }
  });

  it("isAgendaSourceId só aceita fontes registadas", () => {
    expect(isAgendaSourceId("WORK_ITEM")).toBe(true);
    for (const bad of ["work_item", "LEAD", "", "toString", "__proto__", null]) expect(isAgendaSourceId(bad)).toBe(false);
  });
});

describe("fusos horários", () => {
  it("dayIn dá o dia no fuso pedido", () => {
    const instant = new Date("2026-03-10T23:30:00.000Z");
    expect(dayIn(instant, "UTC")).toBe("2026-03-10");
    expect(dayIn(instant, "Europe/Lisbon")).toBe("2026-03-10");
    expect(dayIn(instant, "Asia/Tokyo")).toBe("2026-03-11");
    expect(dayIn(instant, "America/New_York")).toBe("2026-03-10");
  });

  it("isTimeZone recusa nomes inválidos ou com caracteres estranhos", () => {
    expect(isTimeZone("Europe/Lisbon")).toBe(true);
    for (const bad of ["Europa/Lisboa", "UTC'; DROP TABLE x;--", ""]) expect(isTimeZone(bad)).toBe(false);
  });
});
