import { monotonicNow } from "./monotonic-clock";

describe("monotonicNow", () => {
  it("devolve instantes estritamente crescentes, mesmo no mesmo milissegundo", () => {
    const spy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const times = [monotonicNow(), monotonicNow(), monotonicNow()].map((d) => d.getTime());
      expect(times[1]).toBeGreaterThan(times[0]);
      expect(times[2]).toBeGreaterThan(times[1]);
    } finally {
      spy.mockRestore();
    }
  });

  it("acompanha o relógio quando este avança", () => {
    const t = monotonicNow().getTime();
    const spy = jest.spyOn(Date, "now").mockReturnValue(t + 10_000);
    try {
      expect(monotonicNow().getTime()).toBe(t + 10_000);
    } finally {
      spy.mockRestore();
    }
  });
});
