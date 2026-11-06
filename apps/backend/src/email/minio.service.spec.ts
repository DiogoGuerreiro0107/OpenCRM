import { ConfigService } from "@nestjs/config";
import { MinioService } from "./minio.service";

function serviceWith(env: Record<string, string>) {
  const base = {
    MINIO_ENDPOINT: "minio",
    MINIO_PORT: "9000",
    MINIO_ACCESS_KEY: "chave-de-teste",
    MINIO_SECRET_KEY: "segredo-de-teste",
    MINIO_BUCKET: "anexos",
    MINIO_USE_SSL: "false",
    ...env,
  };
  return new MinioService({ get: (key: string) => base[key as keyof typeof base] } as unknown as ConfigService);
}

describe("MinioService.getDownloadUrl", () => {
  it("sem MINIO_PUBLIC_URL assina com o endereço interno (comportamento de desenvolvimento)", async () => {
    const url = new URL(await serviceWith({}).getDownloadUrl("pasta/ficheiro.pdf"));
    expect(url.origin).toBe("http://minio:9000");
    expect(url.pathname).toBe("/anexos/pasta/ficheiro.pdf");
  });

  it("com MINIO_PUBLIC_URL o link aponta ao endereço que o browser alcança", async () => {
    const url = new URL(
      await serviceWith({ MINIO_PUBLIC_URL: "http://192.168.50.10:9000" }).getDownloadUrl("pasta/ficheiro.pdf"),
    );
    expect(url.origin).toBe("http://192.168.50.10:9000");
    expect(url.pathname).toBe("/anexos/pasta/ficheiro.pdf");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("ignora a barra final do endereço público", async () => {
    const url = new URL(
      await serviceWith({ MINIO_PUBLIC_URL: "http://192.168.50.10:9000/" }).getDownloadUrl("a.pdf"),
    );
    expect(url.origin).toBe("http://192.168.50.10:9000");
    expect(url.pathname).toBe("/anexos/a.pdf");
  });

  it("o link expira (assinado por 5 minutos) e não contém o segredo", async () => {
    const link = await serviceWith({ MINIO_PUBLIC_URL: "http://192.168.50.10:9000" }).getDownloadUrl("a.pdf");
    expect(new URL(link).searchParams.get("X-Amz-Expires")).toBe("300");
    expect(link).not.toContain("segredo-de-teste");
  });
});
