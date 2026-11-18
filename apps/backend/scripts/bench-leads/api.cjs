/**
 * Mede a API das leads (Fase 1c) por HTTP, com a aplicação compilada (dist/) ligada a uma base TEMPORÁRIA com
 * 200 000 leads (api-seed.sql). Mede o caminho todo: validação, guardas, Prisma, Postgres e JSON.
 * Uso (depois de `pnpm --filter backend build`):
 *   node scripts/bench-leads/api.cjs "<DATABASE_URL da base temporária (com «bench» no nome)>"
 * Cada pedido: 3 aquecimentos + 20 medições; imprime uma tabela Markdown com mediana e p95 (ms).
 */
const url = process.argv[2];
if (!url || !/bench/.test(url)) {
  console.error("Indica o URL de uma base de dados de TESTE de carga (o nome tem de conter «bench»).");
  process.exit(1);
}
// Configuração só deste processo: nada sai para fora (sem webhooks), segredos descartáveis.
process.env.DATABASE_URL = url;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "bench-jwt-secret";
process.env.JWT_REFRESH_SECRET = "bench-jwt-refresh-secret";
process.env.SECRETS_KEY = "bench-secrets-key-com-mais-de-32-caracteres";
process.env.N8N_WEBHOOK_URL = "";

const dist = (p) => require(require("path").join(__dirname, "../../dist", p));
const { NestFactory } = require(require.resolve("@nestjs/core", { paths: [__dirname + "/../.."] }));
const { JwtService } = require(require.resolve("@nestjs/jwt", { paths: [__dirname + "/../.."] }));

// O limitador global (300 pedidos/min por IP) mediria o limitador e não a API: desligado SÓ neste processo.
const { ThrottlerGuard } = require(require.resolve("@nestjs/throttler", { paths: [__dirname + "/../.."] }));
ThrottlerGuard.prototype.canActivate = async () => true;

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function main() {
  const app = await NestFactory.create(dist("app.module").AppModule, { logger: ["error"] });
  dist("app.setup").configureApp(app);
  await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const token = await app
    .get(JwtService)
    .signAsync({ sub: "bench-user-1", email: "bench1@bench.invalid", role: "COMERCIAL" }, { secret: process.env.JWT_SECRET, expiresIn: "10m" });
  const headers = { Authorization: `Bearer ${token}` };
  const get = async (path) => {
    const res = await fetch(base + path, { headers });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };

  // Cursor fundo: 200 páginas de 50 (10 000 linhas) dentro do separador NOVO.
  let cursor = null;
  for (let i = 0; i < 200; i++) cursor = (await get(`/leads/page?status=NOVO${cursor ? `&cursor=${cursor}` : ""}`)).nextCursor;

  const cases = [
    ["Lista, 1.ª página (todas)", "/leads/page"],
    ["Separador NOVO, 1.ª página", "/leads/page?status=NOVO"],
    ["Separador + responsável", "/leads/page?status=NOVO&responsavelId=bench-user-3"],
    ["Separador + tipo (empresa)", "/leads/page?status=NOVO&kind=COMPANY"],
    ["Página funda (depois de 10 000)", `/leads/page?status=NOVO&cursor=${cursor}`],
    ["Pesquisa comum («silva»)", "/leads/page?search=silva"],
    ["Pesquisa rara (um email)", "/leads/page?search=lead123456@"],
    ["Pesquisa por NIF", "/leads/page?search=500123456"],
    ["Contagens (todas)", "/leads/counts"],
    ["Contagens + responsável", "/leads/counts?responsavelId=bench-user-3"],
    ["Contagens + pesquisa comum", "/leads/counts?search=silva"],
  ];

  console.log("| Pedido | Linhas | Mediana (ms) | p95 (ms) |\n|---|---|---|---|");
  for (const [name, path] of cases) {
    for (let i = 0; i < 3; i++) await get(path);
    const times = [];
    let body;
    for (let i = 0; i < 20; i++) {
      const t = process.hrtime.bigint();
      body = await get(path);
      times.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    times.sort((a, b) => a - b);
    const rows = body.items ? body.items.length : `total ${body.total}`;
    console.log(`| ${name} | ${rows} | ${percentile(times, 50).toFixed(1)} | ${percentile(times, 95).toFixed(1)} |`);
  }
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
