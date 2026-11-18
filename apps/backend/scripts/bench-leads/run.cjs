/**
 * Mede as consultas da página de leads nas duas formas (A: duas tabelas + UNION ALL; B: uma tabela).
 * Uso: node scripts/bench-leads/run.cjs "<DATABASE_URL da base TEMPORÁRIA de teste>"
 * Cada consulta: 3 execuções de aquecimento + 20 medições com EXPLAIN (ANALYZE) — tempo dentro do Postgres
 * (planeamento + execução), sem rede. Imprime uma tabela Markdown com mediana e p95, e verifica que A e B devolvem
 * os mesmos ids (senão a comparação não valeria nada).
 */
const { PrismaClient } = require(require.resolve("@prisma/client", { paths: [__dirname + "/../.."] }));

const url = process.argv[2];
if (!url || !/bench/.test(url)) {
  console.error("Indica o URL de uma base de dados de TESTE de carga (o nome tem de conter «bench»).");
  process.exit(1);
}
const db = new PrismaClient({ datasources: { db: { url } } });

const COLS = "id, name, company_name, email, phone, status, owner_id, next_action_at, next_action_sort";
const SEARCH = "(coalesce(name,'') || ' ' || coalesce(company_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(phone,''))";
const both = (where) =>
  `(SELECT ${COLS}, 'COMPANY' AS kind FROM lead_company WHERE ${where}) UNION ALL (SELECT ${COLS}, 'PERSON' AS kind FROM lead_person WHERE ${where})`;

async function main() {
  // Cursor «fundo» (depois de 10 000 linhas no separador NOVO), calculado uma vez.
  const [deep] = await db.$queryRawUnsafe(
    `SELECT next_action_sort AS s, id FROM lead_b WHERE status = 'NOVO' ORDER BY next_action_sort, id OFFSET 10000 LIMIT 1`,
  );
  const cursor = `(next_action_sort, id) > ('${deep.s.toISOString()}'::timestamptz, '${deep.id}'::uuid)`;

  const cases = [
    {
      name: "1. Separador (estado + responsável), 1.ª página",
      B: `SELECT ${COLS}, kind FROM lead_b WHERE status = 'NOVO' AND owner_id = 3 ORDER BY next_action_sort, id LIMIT 50`,
      A: `SELECT * FROM (${both("status = 'NOVO' AND owner_id = 3")}) u ORDER BY next_action_sort, id LIMIT 50`,
    },
    {
      name: "2. Página funda por cursor (depois de 10 000)",
      B: `SELECT ${COLS}, kind FROM lead_b WHERE status = 'NOVO' AND ${cursor} ORDER BY next_action_sort, id LIMIT 50`,
      A: `SELECT * FROM (${both(`status = 'NOVO' AND ${cursor}`)}) u ORDER BY next_action_sort, id LIMIT 50`,
    },
    {
      name: "2b. A mesma com OFFSET 10 000 (o que NÃO se usa)",
      B: `SELECT ${COLS}, kind FROM lead_b WHERE status = 'NOVO' ORDER BY next_action_sort, id OFFSET 10001 LIMIT 50`,
      A: `SELECT * FROM (${both("status = 'NOVO'")}) u ORDER BY next_action_sort, id OFFSET 10001 LIMIT 50`,
    },
    {
      name: "3. Pesquisa «silva», 1.ª página",
      B: `SELECT ${COLS}, kind FROM lead_b WHERE ${SEARCH} ILIKE '%silva%' ORDER BY next_action_sort, id LIMIT 50`,
      A: `SELECT * FROM (${both(`${SEARCH} ILIKE '%silva%'`)}) u ORDER BY next_action_sort, id LIMIT 50`,
    },
    {
      name: "3b. Pesquisa rara (poucos resultados)",
      B: `SELECT ${COLS}, kind FROM lead_b WHERE ${SEARCH} ILIKE '%1234@%' ORDER BY next_action_sort, id LIMIT 50`,
      A: `SELECT * FROM (${both(`${SEARCH} ILIKE '%1234@%'`)}) u ORDER BY next_action_sort, id LIMIT 50`,
    },
    {
      name: "4. Contagens por separador (todas)",
      B: `SELECT status, count(*) FROM lead_b GROUP BY status ORDER BY status`,
      A: `SELECT status, sum(n) AS count FROM (SELECT status, count(*) n FROM lead_company GROUP BY status UNION ALL SELECT status, count(*) n FROM lead_person GROUP BY status) u GROUP BY status ORDER BY status`,
    },
    {
      name: "4b. Contagens por separador de um responsável",
      B: `SELECT status, count(*) FROM lead_b WHERE owner_id = 3 GROUP BY status ORDER BY status`,
      A: `SELECT status, sum(n) AS count FROM (SELECT status, count(*) n FROM lead_company WHERE owner_id = 3 GROUP BY status UNION ALL SELECT status, count(*) n FROM lead_person WHERE owner_id = 3 GROUP BY status) u GROUP BY status ORDER BY status`,
    },
    {
      name: "5. Todos os tipos por próxima ação, 1.ª página",
      B: `SELECT ${COLS}, kind FROM lead_b ORDER BY next_action_sort, id LIMIT 50`,
      A: `SELECT * FROM (${both("true")}) u ORDER BY next_action_sort, id LIMIT 50`,
    },
  ];

  const time = async (sql) => {
    const [row] = await db.$queryRawUnsafe(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`);
    const plan = row["QUERY PLAN"][0];
    return plan["Planning Time"] + plan["Execution Time"];
  };
  const stats = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return { median: s[Math.floor(s.length / 2)], p95: s[Math.floor(s.length * 0.95) - 1] ?? s[s.length - 1] };
  };

  const counts = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM lead_b`);
  console.log(`\nLeads: ${counts[0].n}. Mediana e p95 de 20 medições (ms, dentro do Postgres).\n`);
  console.log("| Consulta | B mediana | B p95 | A mediana | A p95 | B/A | mesmos resultados |");
  console.log("|---|---:|---:|---:|---:|---:|---|");
  const results = [];
  for (const c of cases) {
    // Os dois lados têm de devolver exatamente o mesmo (ids pela mesma ordem, ou as mesmas contagens).
    // Só os ids (o valor «infinity» da chave de ordenação não se consegue ler no cliente; a ordem é a mesma).
    const idsOnly = (sql) => sql.replace(`SELECT ${COLS}, kind FROM lead_b`, "SELECT id FROM lead_b").replace("SELECT * FROM (", "SELECT id FROM (");
    const rb = JSON.stringify(await db.$queryRawUnsafe(idsOnly(c.B)), (k, v) => (typeof v === "bigint" ? Number(v) : v));
    const ra = JSON.stringify(await db.$queryRawUnsafe(idsOnly(c.A)), (k, v) => (typeof v === "bigint" ? Number(v) : v));
    const ids = (r) => JSON.parse(r).map((x) => x.id ?? `${x.status}:${x.count}`).join(",");
    const same = ids(rb) === ids(ra);

    for (let i = 0; i < 3; i++) {
      await time(c.B);
      await time(c.A);
    }
    const tb = [];
    const ta = [];
    for (let i = 0; i < 20; i++) {
      tb.push(await time(c.B));
      ta.push(await time(c.A));
    }
    const b = stats(tb);
    const a = stats(ta);
    results.push({ name: c.name, b, a, same });
    console.log(`| ${c.name} | ${b.median.toFixed(2)} | ${b.p95.toFixed(2)} | ${a.median.toFixed(2)} | ${a.p95.toFixed(2)} | ${(b.median / a.median).toFixed(2)}× | ${same ? "sim" : "**NÃO**"} |`);
  }

  // Critério fixado no plano ANTES de medir.
  const firstPages = results.filter((r) => /1\.ª página/.test(r.name));
  const tooSlow = results.filter((r) => !/OFFSET/.test(r.name) && r.b.median > 2 * r.a.median);
  const slowFirst = firstPages.filter((r) => r.b.median >= 50);
  const mismatch = results.filter((r) => !r.same);
  console.log("\nCritério: B não mais de 2× mais lento do que A em nenhuma consulta (excluindo a de OFFSET, que não se usa) e 1.ª página abaixo de 50 ms (mediana).");
  console.log(`- Consultas em que B é mais de 2× mais lento: ${tooSlow.length ? tooSlow.map((r) => r.name).join("; ") : "nenhuma"}`);
  console.log(`- 1.ªs páginas de B acima de 50 ms: ${slowFirst.length ? slowFirst.map((r) => r.name).join("; ") : "nenhuma"}`);
  console.log(`- Resultados diferentes entre A e B: ${mismatch.length ? mismatch.map((r) => r.name).join("; ") : "nenhum"}`);
  console.log(`\nDECISÃO PELO CRITÉRIO: ${tooSlow.length === 0 && slowFirst.length === 0 && mismatch.length === 0 ? "B (uma tabela)" : "falha o critério: decisão volta ao utilizador"}`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
