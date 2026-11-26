import * as fs from "node:fs";
import * as path from "node:path";
import { BUILTIN_EXTENSIONS } from "../extensions/builtin";
import { JOB_LIST, JOBS, isJobId } from "./job-catalog";
import { shortError } from "./jobs.service";

/**
 * Testes estruturais das tarefas agendadas (Fase E1.2): o agendador é do núcleo. Um `@Cron` novo fora do agendador,
 * uma tarefa sem trabalho registado ou uma extensão que agenda sem o declarar fazem falhar o CI.
 */
const SRC = path.resolve(__dirname, "..");
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return files(full);
    return e.name.endsWith(".ts") && !e.name.endsWith(".spec.ts") ? [full] : [];
  });
const sources = files(SRC).map((f) => ({ file: path.relative(SRC, f).replace(/\\/g, "/"), text: fs.readFileSync(f, "utf8") }));

describe("tarefas agendadas (estrutura)", () => {
  it("só o agendador do núcleo usa @Cron, @Interval, @Timeout ou setInterval", () => {
    const offenders = sources.filter((s) => s.file !== "jobs/jobs.scheduler.ts" && /@Cron\(|@Interval\(|@Timeout\(|setInterval\(/.test(s.text)).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it("o agendador tem um @Cron por tarefa, com o horário do catálogo, e só passa a tarefa ao registo", () => {
    const scheduler = sources.find((s) => s.file === "jobs/jobs.scheduler.ts")!.text;
    const pattern = /@Cron\(JOBS\["([^"]+)"\]\.cron\)\s*\n\s*\w+\(\)\s*\{\s*\n\s*return this\.jobs\.trigger\("([^"]+)"\);\s*\n\s*\}/g;
    const pairs = [...scheduler.matchAll(pattern)].map((m) => [m[1], m[2]]);
    expect(pairs.every(([a, b]) => a === b)).toBe(true);
    expect(pairs.map(([a]) => a).sort()).toEqual(JOB_LIST.map((j) => j.id).sort());
    expect((scheduler.match(/@Cron\(/g) ?? []).length).toBe(JOB_LIST.length);
  });

  it("todas as tarefas têm trabalho registado (handle) num serviço, uma só vez", () => {
    const all = sources.map((s) => s.text).join("\n");
    for (const job of JOB_LIST) {
      const count = all.split(`handle("${job.id}"`).length - 1;
      expect({ job: job.id, count }).toEqual({ job: job.id, count: 1 });
    }
  });

  it("as extensões donas de tarefas declaram jobs:schedule, e só elas", () => {
    const owners = [...new Set(JOB_LIST.map((j) => j.extension).filter((e): e is NonNullable<typeof e> => !!e))].sort();
    const declaring = BUILTIN_EXTENSIONS.filter((e) => e.permissions.includes("jobs:schedule")).map((e) => e.id).sort();
    expect(declaring).toEqual(owners);
  });

  it("catálogo coerente: id = chave, limites e disjuntor válidos, horário em português", () => {
    for (const [key, job] of Object.entries(JOBS)) {
      expect(job.id).toBe(key);
      expect(isJobId(key)).toBe(true);
      expect(job.timeoutMs).toBeGreaterThanOrEqual(1000);
      expect(job.pauseAfterFailures).toBeGreaterThanOrEqual(1);
      expect(job.scheduleText.length).toBeGreaterThan(0);
      expect(job.cron.trim().split(/\s+/).length).toBeGreaterThanOrEqual(5);
    }
    expect(isJobId("nao-existe")).toBe(false);
    expect(isJobId("constructor")).toBe(false);
  });
});

describe("shortError", () => {
  it("guarda só a primeira linha, encurtada", () => {
    expect(shortError(new Error("falhou\n    at algures (x.ts:1)"))).toBe("falhou");
    expect(shortError("texto")).toBe("texto");
    expect(shortError(new Error(""))).toBe("Erro sem mensagem");
    const long = shortError(new Error("x".repeat(600)));
    expect(long).toHaveLength(500);
    expect(long.endsWith("...")).toBe(true);
  });
});
