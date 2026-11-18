import { foldSearch } from "./search-text";

describe("foldSearch (termo de pesquisa sem acentos)", () => {
  it("tira acentos, cedilhas e tis, em minúsculas", () => {
    expect(foldSearch("João")).toBe("joao");
    expect(foldSearch("GRÁFICA São Tomé")).toBe("grafica sao tome");
    expect(foldSearch("Açores, Ângela, Côrte-Real, Pão")).toBe("acores, angela, corte-real, pao");
  });

  it("letras que não se decompõem: como o unaccent do Postgres", () => {
    expect(foldSearch("Straße Ærø Łódź")).toBe("strasse aero lodz");
  });

  it("não mexe em dígitos, @ e espaços (NIF, emails, telefones)", () => {
    expect(foldSearch("PT 501 234 567")).toBe("pt 501 234 567");
    expect(foldSearch("Ana@Exemplo.PT")).toBe("ana@exemplo.pt");
  });
});
