import { companyNameOf, hasPerson, normalizePhone, normalizeTaxId } from "./lead-conversion";

describe("regras da conversão de leads", () => {
  it("NIF: ignora espaços, pontuação, maiúsculas e o prefixo PT de um NIF português", () => {
    expect(normalizeTaxId(" pt 501 234 567 ")).toBe("501234567");
    expect(normalizeTaxId("PT-501.234.567")).toBe("501234567");
    expect(normalizeTaxId("501234567")).toBe("501234567");
    // o prefixo só sai com 9 dígitos a seguir (NIFs estrangeiros ficam como estão)
    expect(normalizeTaxId("ESB12345678")).toBe("ESB12345678");
    expect(normalizeTaxId("PT12345")).toBe("PT12345");
    expect(normalizeTaxId(null)).toBe("");
  });

  it("telefone: só dígitos, sem o indicativo 351 à frente de 9 dígitos", () => {
    expect(normalizePhone("+351 912 345 678")).toBe("912345678");
    expect(normalizePhone("00351912345678")).toBe("912345678");
    expect(normalizePhone("912-345-678")).toBe("912345678");
    expect(normalizePhone("+34 612 345 678")).toBe("34612345678");
    expect(normalizePhone(undefined)).toBe("");
  });

  it("empresa e pessoa de uma lead, conforme o tipo", () => {
    // lead de empresa com contacto principal
    expect(companyNameOf({ kind: "COMPANY", name: "Ana", companyName: "Acme" })).toBe("Acme");
    expect(hasPerson({ kind: "COMPANY", name: "Ana", companyName: "Acme" })).toBe(true);
    // lead de empresa sem contacto principal (a interface grava o nome da empresa)
    expect(hasPerson({ kind: "COMPANY", name: " acme ", companyName: "Acme" })).toBe(false);
    // lead de empresa sem nome de empresa: é a própria empresa, sem pessoa
    expect(companyNameOf({ kind: "COMPANY", name: "Acme", companyName: null })).toBe("Acme");
    expect(hasPerson({ kind: "COMPANY", name: "Acme", companyName: "  " })).toBe(false);
    // lead de pessoa: sempre pessoa; empresa só se tiver nome de empresa
    expect(hasPerson({ kind: "PERSON", name: "Acme", companyName: "Acme" })).toBe(true);
    expect(companyNameOf({ kind: "PERSON", name: "Rui", companyName: null })).toBe("");
  });
});
