import { computeLine, computeTotals, lineText, orderCode } from "./orders.service";

// Fase 6a: cálculo das linhas e dos totais das encomendas (valores indicativos, a cêntimos).
describe("computeLine", () => {
  it("quantidade × preço, menos o desconto, arredondado a cêntimos; IVA sobre o total da linha", () => {
    const { net, vat } = computeLine({ quantity: 1.5, unitPrice: 10.01, discountPct: 12.5, vatRate: 6 });
    expect(net.toNumber()).toBe(13.14); // 13,138125
    expect(vat.toNumber()).toBe(0.79); // 0,7884
  });

  it("sem erros de vírgula flutuante (0,1 × 3) e meio cêntimo para cima", () => {
    expect(computeLine({ quantity: 3, unitPrice: 0.1, discountPct: 0, vatRate: 0 }).net.toNumber()).toBe(0.3);
    expect(computeLine({ quantity: 1, unitPrice: 0.05, discountPct: 50, vatRate: 0 }).net.toNumber()).toBe(0.03); // 0,025
    expect(computeLine({ quantity: 1, unitPrice: 2.5, discountPct: 0, vatRate: 23 }).vat.toNumber()).toBe(0.58); // 0,575
  });

  it("valores grandes sem perder precisão", () => {
    expect(computeLine({ quantity: 99_999_999, unitPrice: 999_999_999, discountPct: 0, vatRate: 0 }).net.toString()).toBe("99999998900000001");
  });

  it("desconto de 100% dá zero", () => {
    expect(computeLine({ quantity: 4, unitPrice: 12.34, discountPct: 100, vatRate: 23 }).net.toNumber()).toBe(0);
  });
});

describe("computeTotals", () => {
  it("soma as linhas já arredondadas; total = sem IVA + IVA", () => {
    const totals = computeTotals([
      { quantity: 3, unitPrice: 45.9, discountPct: 0, vatRate: 23 },
      { quantity: 1.5, unitPrice: 10.01, discountPct: 12.5, vatRate: 6 },
    ]);
    expect([totals.subtotal.toNumber(), totals.vatTotal.toNumber(), totals.total.toNumber()]).toEqual([150.84, 32.46, 183.3]);
  });

  it("sem linhas, tudo a zero", () => {
    const totals = computeTotals([]);
    expect([totals.subtotal.toNumber(), totals.vatTotal.toNumber(), totals.total.toNumber()]).toEqual([0, 0, 0]);
  });
});

describe("textos", () => {
  it("número da encomenda e linha na timeline", () => {
    expect(orderCode(7)).toBe("EN-0007");
    expect(orderCode(12345)).toBe("EN-12345");
    expect(lineText({ quantity: 2, description: "Toner", sku: "TN-1", unitPrice: 45.9, discountPct: 10 })).toBe("2 × Toner (TN-1) a 45,90 € −10%");
    expect(lineText({ quantity: 1.5, description: "Portes", sku: null, unitPrice: 5, discountPct: 0 })).toBe("1,5 × Portes a 5,00 €");
  });
});
