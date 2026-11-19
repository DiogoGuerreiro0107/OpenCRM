/**
 * Mede as listagens paginadas (docs/plano-paginacao-listagens.md) por HTTP, com a aplicação compilada (dist/) ligada a
 * uma base TEMPORÁRIA com o volume de seed.sql. Mede o caminho todo: validação, guardas, Prisma, Postgres e JSON.
 * Uso (depois de `pnpm --filter backend build`):
 *   node scripts/bench-listagens/api.cjs "<DATABASE_URL da base temporária (com «bench» no nome)>"
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
    .signAsync({ sub: "bench-user-1", email: "bench1@bench.invalid", role: "ADMINISTRADOR" }, { secret: process.env.JWT_SECRET, expiresIn: "10m" });
  const headers = { Authorization: `Bearer ${token}` };
  const get = async (path) => {
    const res = await fetch(base + path, { headers });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  };
  /** Cursor depois de `pages` páginas de 50 (página funda). */
  const deep = async (path, pages) => {
    let cursor = null;
    const sep = path.includes("?") ? "&" : "?";
    for (let i = 0; i < pages; i++) cursor = (await get(`${path}${cursor ? `${sep}cursor=${cursor}` : ""}`)).nextCursor;
    return `${path}${sep}cursor=${cursor}`;
  };

  const timeline = "/timeline?entityType=COMPANY&entityId=bench-co-1";
  const column = "/deals?pipelineId=bench-pipe&stageId=bench-st-3";
  const cases = [
    ["Empresas, 1.ª página", "/companies"],
    ["Empresas, página funda (10 000)", await deep("/companies", 200)],
    ["Empresas, pesquisa «sao joao»", "/companies?search=sao%20joao"],
    ["Empresas, separador ATIVO", "/companies?status=ATIVO"],
    ["Seletor de empresas (20)", "/companies?search=grafica&limit=20"],
    ["Ficha da empresa grande (2 000 contactos)", "/companies/bench-co-1"],
    ["Contactos, 1.ª página", "/contacts"],
    ["Contactos da empresa grande (2 000)", "/contacts?companyId=bench-co-1&limit=20"],
    ["Contactos, pesquisa «joao silva»", "/contacts?search=joao%20silva"],
    ["Tarefas, 1.ª página", "/tasks"],
    ["Tarefas, página funda (10 000)", await deep("/tasks", 200)],
    ["Tarefas, atrasadas", "/tasks?overdue=true"],
    ["Tarefas, pesquisa «proposta»", "/tasks?search=proposta"],
    ["Calendário (6 semanas)", `/tasks/calendar?from=${new Date(Date.now() - 21 * 864e5).toISOString()}&to=${new Date(Date.now() + 21 * 864e5).toISOString()}`],
    ["Kanban, coluna de 100 000 (30)", `${column}&limit=30`],
    ["Kanban, coluna, página funda (10 000)", await deep(column, 200)],
    ["Kanban, resumo por fase", "/deals/summary?pipelineId=bench-pipe"],
    ["Kanban, pesquisa «negocio 1234»", "/deals?pipelineId=bench-pipe&search=negocio%201234&limit=30"],
    ["Emails, 1.ª página", "/email/messages?limit=30"],
    ["Emails, pesquisa «orcamento»", "/email/messages?search=orcamento&limit=30"],
    ["Timeline (50 000 da empresa), 1.ª", `${timeline}&limit=20`],
    ["Timeline, página funda (10 000)", await deep(timeline, 200)],
    ["Chamadas, 1.ª página", "/zadarma/calls?limit=20"],
    ["Dashboard (contagens)", "/dashboard/summary"],
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
    const rows = Array.isArray(body) ? body.length : body.items ? body.items.length : "—";
    console.log(`| ${name} | ${rows} | ${percentile(times, 50).toFixed(1)} | ${percentile(times, 95).toFixed(1)} |`);
  }
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
