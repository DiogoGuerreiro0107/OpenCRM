import { trackingTemplateProblem, trackingUrl } from "./carriers.service";
import { transportText } from "./orders.service";

// Fase 6d: link de seguimento das transportadoras e o texto do transporte na timeline.
describe("transportadoras e expedições", () => {
  it("o link tem de ser http(s) e ter {codigo}", () => {
    expect(trackingTemplateProblem("https://t.pt/?n={codigo}")).toBeNull();
    expect(trackingTemplateProblem("http://t.pt/{codigo}/estado")).toBeNull();
    expect(trackingTemplateProblem("https://t.pt/seguir")).toMatch(/\{codigo\}/);
    expect(trackingTemplateProblem("ftp://t.pt/{codigo}")).toMatch(/http/);
    expect(trackingTemplateProblem("javascript:alert({codigo})")).toMatch(/http/);
    expect(trackingTemplateProblem("não é um link {codigo}")).toBe("Link inválido");
  });

  it("o link de seguimento troca cada {codigo} pelo código codificado; sem um dos dois, não há", () => {
    expect(trackingUrl("https://t.pt/?n={codigo}", "AB 12/3&x")).toBe("https://t.pt/?n=AB%2012%2F3%26x");
    expect(trackingUrl("https://t.pt/{codigo}?c={codigo}", "X1")).toBe("https://t.pt/X1?c=X1");
    expect(trackingUrl(null, "X1")).toBeNull();
    expect(trackingUrl("https://t.pt/{codigo}", null)).toBeNull();
    expect(trackingUrl("https://t.pt/{codigo}", "")).toBeNull();
  });

  it("texto do transporte: só o que está preenchido, com volumes no singular e no plural", () => {
    expect(transportText({ carrierName: "CTT", trackingCode: "A1", packages: 2, weightKg: 3.5, cost: 7.9 })).toBe("CTT · código A1 · 2 volumes · 3,5 kg · 7,90 €");
    expect(transportText({ packages: 1, weightKg: 0, cost: 0 })).toBe("1 volume · 0 kg · 0,00 €");
    expect(transportText({})).toBe("");
  });
});
