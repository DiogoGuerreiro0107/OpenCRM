import { durationSeconds, exceedsMaxDuration, formatDuration, formatRange, isForgotten } from "./time-entry-rules";

describe("regras do registo de tempo (Fase 4b)", () => {
  const at = (iso: string) => new Date(iso);

  it("duração: até ao fim, ou até agora se corre; nunca negativa", () => {
    expect(durationSeconds({ startedAt: at("2026-11-20T10:00:00Z"), endedAt: at("2026-11-20T11:30:00Z") })).toBe(5400);
    expect(durationSeconds({ startedAt: at("2026-11-20T10:00:00Z"), endedAt: null }, at("2026-11-20T10:00:42Z"))).toBe(42);
    expect(durationSeconds({ startedAt: at("2026-11-20T10:00:00Z"), endedAt: null }, at("2026-11-20T09:00:00Z"))).toBe(0);
  });

  it("esquecido: só a correr e há mais de 8 h", () => {
    const startedAt = at("2026-11-20T00:00:00Z");
    expect(isForgotten({ startedAt, endedAt: null }, at("2026-11-20T08:00:00Z"))).toBe(false);
    expect(isForgotten({ startedAt, endedAt: null }, at("2026-11-20T08:00:01Z"))).toBe(true);
    expect(isForgotten({ startedAt, endedAt: at("2026-11-20T20:00:00Z") }, at("2026-11-21T00:00:00Z"))).toBe(false);
  });

  it("máximo de 24 h por registo", () => {
    expect(exceedsMaxDuration(at("2026-11-19T10:00:00Z"), at("2026-11-20T10:00:00Z"))).toBe(false);
    expect(exceedsMaxDuration(at("2026-11-19T10:00:00Z"), at("2026-11-20T10:00:01Z"))).toBe(true);
  });

  it("textos: duração e intervalo no fuso pedido (Lisboa por omissão; fuso inválido também)", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(45 * 60)).toBe("45 min");
    expect(formatDuration(3600 + 5 * 60)).toBe("1h05");
    const entry = { startedAt: at("2026-07-01T09:00:00Z"), endedAt: at("2026-07-01T10:30:00Z") };
    expect(formatRange(entry)).toBe("01/07 10:00–11:30");
    expect(formatRange(entry, "Não/Existe")).toBe("01/07 10:00–11:30");
    expect(formatRange(entry, "UTC")).toBe("01/07 09:00–10:30");
    expect(formatRange({ ...entry, endedAt: null })).toBe("01/07 10:00–(a correr)");
  });
});
