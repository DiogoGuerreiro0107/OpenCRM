import { normalizePhone, signZadarmaRequest } from "./zadarma.utils";

describe("normalizePhone", () => {
  it.each([
    ["+351 912 345 678", "912345678"],
    ["912345678", "912345678"],
    ["00351912345678", "912345678"],
    ["(+351) 912-345-678", "912345678"],
    ["", ""],
    ["abc", ""],
  ])("%j -> %j", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("formatos diferentes do mesmo número dão o mesmo resultado", () => {
    expect(normalizePhone("+351 912 345 678")).toBe(normalizePhone("912345678"));
  });
});

describe("signZadarmaRequest", () => {
  // Valores de referência calculados com um cálculo independente (md5 + hmac-sha1 + base64) a partir da
  // documentação pública. Protegem contra regressões acidentais; NÃO provam compatibilidade com a Zadarma
  // (nunca foi testado com credenciais reais).
  const REFERENCE_QUERY = "from=100&to=%2B351912345678";
  const REFERENCE_SIGNATURE = "OeGfJYTPD8xpXE0ynQLUG6UdPMI=";

  it("gera a query string ordenada e a assinatura esperada", () => {
    const result = signZadarmaRequest("chave-publica", "segredo-de-teste", "/v1/request/callback/", {
      to: "+351912345678",
      from: "100",
    });
    expect(result.queryString).toBe(REFERENCE_QUERY);
    expect(result.authorization).toBe(`chave-publica:${REFERENCE_SIGNATURE}`);
  });

  it("não depende da ordem em que os parâmetros são dados", () => {
    const a = signZadarmaRequest("k", "s", "/v1/x/", { a: "1", b: "2", c: "3" });
    const b = signZadarmaRequest("k", "s", "/v1/x/", { c: "3", a: "1", b: "2" });
    expect(a).toEqual(b);
  });

  it("muda a assinatura se mudar o segredo, o caminho ou um parâmetro", () => {
    const base = signZadarmaRequest("k", "segredo", "/v1/x/", { a: "1" }).authorization;
    expect(signZadarmaRequest("k", "outro", "/v1/x/", { a: "1" }).authorization).not.toBe(base);
    expect(signZadarmaRequest("k", "segredo", "/v1/y/", { a: "1" }).authorization).not.toBe(base);
    expect(signZadarmaRequest("k", "segredo", "/v1/x/", { a: "2" }).authorization).not.toBe(base);
  });

  it("sem parâmetros devolve query string vazia e continua a assinar", () => {
    const result = signZadarmaRequest("k", "s", "/v1/info/balance/", {});
    expect(result.queryString).toBe("");
    expect(result.authorization).toMatch(/^k:.+=$/);
  });

  it("nunca inclui o segredo no Authorization", () => {
    const result = signZadarmaRequest("k", "segredo-muito-secreto", "/v1/x/", { a: "1" });
    expect(result.authorization).not.toContain("segredo-muito-secreto");
  });
});
