import { BadRequestException } from "@nestjs/common";
import { assertKindAllowed, defaultKind, DEFAULT_LEAD_MODE, isLeadMode, leadModeFrom } from "./lead-mode";

describe("modo do módulo de leads", () => {
  it("predefinição BOTH; valores inválidos guardados também dão BOTH", () => {
    expect(DEFAULT_LEAD_MODE).toBe("BOTH");
    expect(leadModeFrom({})).toBe("BOTH");
    expect(leadModeFrom({ mode: "COMPANY" })).toBe("COMPANY");
    expect(leadModeFrom({ mode: "outro" })).toBe("BOTH");
    expect(isLeadMode("PERSON")).toBe(true);
    expect(isLeadMode("person")).toBe(false);
  });

  it("tipo por omissão: o do modo; em BOTH, empresa só com nome de empresa (a regra da migração)", () => {
    expect(defaultKind("COMPANY", {})).toBe("COMPANY");
    expect(defaultKind("PERSON", { companyName: "Acme" })).toBe("PERSON");
    expect(defaultKind("BOTH", { companyName: "Acme" })).toBe("COMPANY");
    expect(defaultKind("BOTH", { companyName: "   " })).toBe("PERSON");
    expect(defaultKind("BOTH", { companyName: null })).toBe("PERSON");
  });

  it("o modo de um só tipo recusa o outro; BOTH aceita os dois", () => {
    expect(() => assertKindAllowed("COMPANY", "PERSON")).toThrow(BadRequestException);
    expect(() => assertKindAllowed("PERSON", "COMPANY")).toThrow(BadRequestException);
    expect(() => assertKindAllowed("COMPANY", "COMPANY")).not.toThrow();
    expect(() => assertKindAllowed("BOTH", "PERSON")).not.toThrow();
    expect(() => assertKindAllowed("BOTH", "COMPANY")).not.toThrow();
  });
});
