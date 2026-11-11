import { decodeCursor, encodeCursor, sanitizeMetadata } from "./audit.service";

describe("sanitizeMetadata", () => {
  it("remove chaves com nome de segredo em qualquer nível", () => {
    const result = sanitizeMetadata({
      name: "Ana",
      password: "x",
      nested: { apiSecret: "y", resetToken: "z", Authorization: "Bearer abc", ok: 1 },
      list: [{ newPassword: "p", keep: true }],
    });
    expect(result).toEqual({ name: "Ana", nested: { ok: 1 }, list: [{ keep: true }] });
    expect(JSON.stringify(result)).not.toMatch(/Bearer|"x"|"y"|"z"|"p"/);
  });

  it("encurta textos longos e limita arrays e profundidade", () => {
    const long = "a".repeat(500);
    expect((sanitizeMetadata({ v: long }) as { v: string }).v.length).toBe(201);
    expect((sanitizeMetadata({ v: Array.from({ length: 50 }, (_, i) => i) }) as { v: number[] }).v).toHaveLength(20);
    expect(JSON.stringify(sanitizeMetadata({ a: { b: { c: { d: { e: 1 } } } } }))).toContain("[omitido]");
  });

  it("deixa passar valores simples", () => {
    expect(sanitizeMetadata(null)).toBeNull();
    expect(sanitizeMetadata(7)).toBe(7);
    expect(sanitizeMetadata(true)).toBe(true);
  });
});

describe("cursor", () => {
  it("ida e volta", () => {
    const date = new Date("2026-11-11T10:20:30.456Z");
    expect(decodeCursor(encodeCursor(date, "abc-123"))).toEqual({ createdAt: date, id: "abc-123" });
  });

  it("lixo ou ausente dá null (nunca lança)", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("isto-nao-e-um-cursor")).toBeNull();
    expect(decodeCursor(Buffer.from("data-invalida|id").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("2026-11-11T10:20:30.456Z").toString("base64url"))).toBeNull();
  });
});
