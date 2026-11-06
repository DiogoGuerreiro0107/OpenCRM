export const DEFAULT_TEST_DATABASE_URL = "postgresql://opencrm:changeme@localhost:5432/opencrm_test?schema=public";

export function getTestDatabaseUrl() {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

/**
 * Salvaguarda: os testes e2e APAGAM todas as tabelas entre cenários. Recusam correr contra uma base de dados
 * cujo nome não contenha "test", para nunca tocarem nos dados reais (ex.: `opencrm`).
 */
export function assertTestDatabase(url: string) {
  const name = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/i.test(name)) {
    throw new Error(
      `Recusado: os testes e2e só correm contra uma base de dados com "test" no nome (recebido: "${name}"). ` +
        "Define TEST_DATABASE_URL para uma base de dados de testes.",
    );
  }
}
