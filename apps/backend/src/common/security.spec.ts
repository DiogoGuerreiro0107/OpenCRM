import { findInsecureSecrets, isAllowedOrigin, isLocalNetworkHost, parseCorsOrigins } from "./security";

describe("isLocalNetworkHost", () => {
  it.each([
    "localhost",
    "LOCALHOST",
    "127.0.0.1",
    "10.0.0.5",
    "192.168.50.10",
    "172.16.0.1",
    "172.31.255.254",
    "crm.globaltoner.local",
  ])("%s é rede local", (host) => {
    expect(isLocalNetworkHost(host)).toBe(true);
  });

  it.each([
    "example.com",
    "evil.example.com",
    "8.8.8.8",
    "172.32.0.1", // fora do intervalo privado 172.16-31
    "172.15.0.1",
    "192.169.1.1",
    "11.0.0.1",
    "192.168.1.1.evil.com", // IP privado só como prefixo de um domínio público
    "local", // sem o ponto não é um nome *.local
  ])("%s NÃO é rede local", (host) => {
    expect(isLocalNetworkHost(host)).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  it("permite pedidos sem Origin (curl, email-worker)", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it("permite o frontend acedido por IP da rede local", () => {
    expect(isAllowedOrigin("http://192.168.50.10:5173")).toBe(true);
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
  });

  it("recusa sites públicos", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.1.evil.com")).toBe(false);
  });

  it("permite origens públicas explicitamente listadas e só essas", () => {
    expect(isAllowedOrigin("https://crm.globaltoner.pt", ["https://crm.globaltoner.pt"])).toBe(true);
    expect(isAllowedOrigin("https://outro.globaltoner.pt", ["https://crm.globaltoner.pt"])).toBe(false);
  });

  it("recusa uma Origin malformada em vez de rebentar", () => {
    expect(isAllowedOrigin("não é um url")).toBe(false);
  });
});

describe("parseCorsOrigins", () => {
  it("separa por vírgulas, apara espaços e ignora vazios", () => {
    expect(parseCorsOrigins(" https://a.pt , ,https://b.pt,")).toEqual(["https://a.pt", "https://b.pt"]);
  });

  it("devolve lista vazia quando não está definido", () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins("")).toEqual([]);
  });
});

describe("findInsecureSecrets", () => {
  const good = { NODE_ENV: "production", JWT_SECRET: "abc", JWT_REFRESH_SECRET: "def", INTERNAL_API_KEY: "ghi", SECRETS_KEY: "uma-chave-real-com-mais-de-32-caracteres" };

  it("em desenvolvimento nunca se queixa", () => {
    expect(findInsecureSecrets({ NODE_ENV: "development", JWT_SECRET: "changeme_jwt_secret" })).toEqual([]);
    expect(findInsecureSecrets({})).toEqual([]);
  });

  it("em produção aceita segredos reais", () => {
    expect(findInsecureSecrets(good)).toEqual([]);
  });

  it("em produção recusa segredos de exemplo ou em falta", () => {
    const problems = findInsecureSecrets({ ...good, JWT_SECRET: "changeme_jwt_secret", INTERNAL_API_KEY: undefined });
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).toContain("JWT_SECRET");
    expect(problems.join(" ")).toContain("INTERNAL_API_KEY");
  });

  it("não revela o valor dos segredos nas mensagens", () => {
    const problems = findInsecureSecrets({ ...good, JWT_SECRET: "changeme_valor_visivel" });
    expect(problems.join(" ")).not.toContain("changeme_valor_visivel");
  });
});

describe("findInsecureSecrets: SECRETS_KEY", () => {
  const good = {
    NODE_ENV: "production",
    JWT_SECRET: "abc",
    JWT_REFRESH_SECRET: "def",
    INTERNAL_API_KEY: "ghi",
    SECRETS_KEY: "uma-chave-real-com-mais-de-32-caracteres",
  };

  it("em produção recusa SECRETS_KEY em falta ou de exemplo", () => {
    expect(findInsecureSecrets({ ...good, SECRETS_KEY: undefined }).join(" ")).toContain("SECRETS_KEY");
    expect(findInsecureSecrets({ ...good, SECRETS_KEY: "changeme_secrets_key_gera_uma_com_openssl" }).join(" ")).toContain("SECRETS_KEY");
  });
});
