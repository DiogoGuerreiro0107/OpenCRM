import { nextStockTaken, partText } from "./service-parts.service";

// Fase 5c: quanto uma peça tirou do stock depois de mudar a quantidade.
describe("nextStockTaken", () => {
  it("subir tira a diferença; baixar devolve a diferença", () => {
    expect(nextStockTaken(2, 2, 3.5)).toBe(3.5);
    expect(nextStockTaken(3.5, 3.5, 1)).toBe(1);
    expect(nextStockTaken(2, 2, 2)).toBe(2);
  });

  it("nunca devolve mais do que a peça tirou", () => {
    // Adicionada com o stock desligado (não tirou nada): baixar não devolve, subir só tira a diferença.
    expect(nextStockTaken(0, 4, 2)).toBe(0);
    expect(nextStockTaken(0, 2, 5)).toBe(3);
    expect(nextStockTaken(1, 4, 0.5)).toBe(0);
  });

  it("arredonda a duas casas", () => {
    expect(nextStockTaken(0.1, 0.1, 0.3)).toBe(0.3);
  });
});

describe("partText", () => {
  it("quantidade à portuguesa e a referência entre parênteses", () => {
    expect(partText({ quantity: 1.5, description: "Cabo", reference: null })).toBe("1,5 × Cabo");
    expect(partText({ quantity: 2, description: "Rolo", reference: "RM2" })).toBe("2 × Rolo (RM2)");
  });
});
