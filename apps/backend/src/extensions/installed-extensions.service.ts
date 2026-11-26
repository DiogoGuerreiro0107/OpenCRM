import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { InstalledExtension, Prisma } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { RealtimeService } from "../realtime/realtime.service";
import { WebhooksService } from "../webhooks/webhooks.service";
import { WebhookEnvelope } from "../webhooks/webhook-core";
import { ModulesService } from "../modules/modules.service";
import { isModuleId } from "../modules/module-manifest";
import { shortError } from "../jobs/jobs.service";
import { BUILTIN_EXTENSIONS } from "./builtin";
import { ExtensionManifest, manifestErrors } from "./manifest";
import { describePermission } from "./permissions";
import { satisfies } from "./semver";
import { fingerprint } from "./fingerprint";
import { ExtensionSettingsService } from "./extension-settings.service";
import { ActivatedExtension, EventHandler, ExtensionContext, ExtensionModule } from "./sdk";

/** Limite para `activate`, `deactivate` e cada subscritor de eventos. */
export const EXTENSION_TIMEOUT_MS = 10_000;
/** Falhas seguidas dos subscritores de eventos que desligam a extensão (disjuntor). */
export const BREAKER_FAILURES = 5;

type Status = "pending" | "changed" | "enabled" | "disabled" | "disabled_auto" | "missing";

interface Loaded {
  handlers: Map<string, EventHandler[]>;
  deactivate?: () => void | Promise<void>;
  failures: number;
}

async function withTimeout<T>(work: Promise<T> | T, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what}: passou o limite de ${ms / 1000} s`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extensões instaladas da pasta `extensions/` (Fase E1.4, docs/plano-fase-e1-extensoes.md). Código da equipa que corre
 * DENTRO do backend, com confiança total (docs/plano-extensoes-e-api.md §9): as garantias são de processo — só a pasta
 * do servidor, só com a impressão digital aprovada por um Administrador, tudo na auditoria. Uma só instância do
 * backend: o código carregado fica em memória.
 */
@Injectable()
export class InstalledExtensionsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("Extensões");
  private readonly loaded = new Map<string, Loaded>();
  /** Problemas da última procura (pastas com manifesto inválido): não têm linha, por isso ficam em memória. */
  private problems: Array<{ folder: string; errors: string[] }> = [];
  private subscribed = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly webhooks: WebhooksService,
    private readonly modules: ModulesService,
    private readonly settings: ExtensionSettingsService,
  ) {}

  /** Limite de `activate`, `deactivate` e de cada evento (método à parte para os testes o poderem encurtar). */
  protected timeoutMs() {
    return EXTENSION_TIMEOUT_MS;
  }

  /** A pasta das extensões: `EXTENSIONS_DIR` ou `extensions/` onde o backend corre. */
  directory(): string {
    return path.resolve(process.env.EXTENSIONS_DIR || path.join(process.cwd(), "extensions"));
  }

  private folderOf(id: string) {
    return path.join(this.directory(), id);
  }

  async onApplicationBootstrap() {
    if (!this.subscribed) {
      this.webhooks.subscribe((envelope) => void this.dispatch(envelope));
      this.subscribed = true;
    }
    await this.rescan(null);
    for (const row of await this.prisma.installedExtension.findMany({ where: { enabled: true }, orderBy: { id: "asc" } })) {
      try {
        await this.load(row);
      } catch (err) {
        await this.markDisabled(row.id, `Não arrancou: ${shortError(err)}`);
      }
    }
  }

  async onModuleDestroy() {
    for (const id of [...this.loaded.keys()]) await this.unload(id);
  }

  // ---------------------------------------------------------------------------------------------------- descoberta

  /** Lê e valida uma pasta. O manifesto tem o id da pasta, não é o de uma embutida e as dependências existem. */
  private readFolder(folder: string, installedIds: Map<string, string>): { manifest?: ExtensionManifest; checksum?: string; errors: string[] } {
    const dir = this.folderOf(folder);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, "extension.json"), "utf8"));
    } catch (err) {
      return { errors: [`extension.json em falta ou inválido: ${shortError(err)}`] };
    }
    const errors = manifestErrors(raw);
    const m = raw as ExtensionManifest;
    if (errors.length) return { errors };
    if (m.origin !== "installed") errors.push(`«${m.id}»: origin tem de ser installed`);
    if (m.id !== folder) errors.push(`«${m.id}»: a pasta tem de ter o nome do id («${folder}»)`);
    if (BUILTIN_EXTENSIONS.some((b) => b.id === m.id)) errors.push(`«${m.id}»: é o id de uma extensão embutida`);
    for (const [dep, range] of Object.entries(m.dependsOn)) {
      const version = BUILTIN_EXTENSIONS.find((b) => b.id === dep)?.version ?? installedIds.get(dep);
      if (!version) errors.push(`«${m.id}»: depende de «${dep}», que não existe`);
      else if (!satisfies(version, range)) errors.push(`«${m.id}»: precisa de «${dep}» ${range}, e há a ${version}`);
    }
    if (m.server && !fs.existsSync(path.join(dir, m.server))) errors.push(`«${m.id}»: server «${m.server}» não existe`);
    if (errors.length) return { errors };
    try {
      return { manifest: m, checksum: fingerprint(dir).checksum, errors: [] };
    } catch (err) {
      return { errors: [`«${m.id}»: ${shortError(err)}`] };
    }
  }

  /**
   * Procura as extensões na pasta: regista as novas, atualiza o manifesto e a impressão digital das que existem, e
   * marca as que desapareceram. Uma ligada cujos ficheiros mudaram desliga-se (o código carregado já não é o aprovado).
   */
  async rescan(actorId: string | null) {
    const dir = this.directory();
    const folders = fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort()
      : [];
    // Primeira passagem só para as versões (dependências entre instaladas).
    const versions = new Map<string, string>();
    for (const folder of folders) {
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, folder, "extension.json"), "utf8")) as Partial<ExtensionManifest>;
        if (typeof m.id === "string" && typeof m.version === "string") versions.set(m.id, m.version);
      } catch {
        // o erro aparece na leitura a sério, abaixo
      }
    }
    const problems: Array<{ folder: string; errors: string[] }> = [];
    const found = new Set<string>();
    for (const folder of folders) {
      const result = this.readFolder(folder, versions);
      if (!result.manifest) {
        problems.push({ folder, errors: result.errors });
        continue;
      }
      const m = result.manifest;
      found.add(m.id);
      const data = { version: m.version, manifest: m as unknown as Prisma.InputJsonValue, checksum: result.checksum!, missing: false };
      const before = await this.prisma.installedExtension.findUnique({ where: { id: m.id } });
      await this.prisma.installedExtension.upsert({ where: { id: m.id }, update: data, create: { id: m.id, ...data } });
      if (before?.enabled && before.approvedChecksum !== result.checksum) {
        await this.unload(m.id);
        await this.markDisabled(m.id, "Os ficheiros mudaram depois de aprovada: aprova de novo");
      }
    }
    for (const row of await this.prisma.installedExtension.findMany({ where: { missing: false } })) {
      if (found.has(row.id)) continue;
      await this.unload(row.id);
      await this.prisma.installedExtension.update({ where: { id: row.id }, data: { missing: true, enabled: false } });
    }
    this.problems = problems;
    if (actorId) await this.audit.record({ action: "extension.rescanned", actorId, metadata: { found: [...found].sort(), problems: problems.length } });
    return this.list();
  }

  // ---------------------------------------------------------------------------------------------- aprovar / ligar

  private async row(id: string) {
    const row = await this.prisma.installedExtension.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Extensão não encontrada");
    if (row.missing) throw new ConflictException("A pasta desta extensão já não existe");
    return row;
  }

  private currentChecksum(id: string) {
    return fingerprint(this.folderOf(id)).checksum;
  }

  /** Aprova ESTA impressão digital (a que o Administrador viu). Se a pasta mudou entretanto, recusa. */
  async approve(id: string, checksum: string, actorId: string) {
    await this.row(id);
    const current = this.currentChecksum(id);
    if (current !== checksum) {
      await this.prisma.installedExtension.update({ where: { id }, data: { checksum: current } });
      throw new ConflictException("Os ficheiros mudaram desde que os viste: procura de novo e confere a impressão digital");
    }
    await this.prisma.installedExtension.update({ where: { id }, data: { checksum: current, approvedChecksum: current, approvedAt: new Date(), approvedById: actorId } });
    await this.audit.record({ action: "extension.approved", actorId, targetType: "extension", targetId: id, metadata: { checksum: current } });
    return this.view(id);
  }

  async enable(id: string, actorId: string) {
    const row = await this.row(id);
    if (!row.approvedChecksum) throw new ConflictException("Aprova a extensão antes de a ligar");
    const current = this.currentChecksum(id);
    if (current !== row.approvedChecksum) {
      await this.prisma.installedExtension.update({ where: { id }, data: { checksum: current } });
      throw new ConflictException("Os ficheiros mudaram depois de aprovada: aprova de novo");
    }
    const manifest = row.manifest as unknown as ExtensionManifest;
    const off = Object.keys(manifest.dependsOn).filter((dep) => (isModuleId(dep) ? !this.modules.isEnabled(dep) : !this.loaded.has(dep)));
    if (off.length) throw new BadRequestException(`Liga primeiro: ${off.join(", ")}`);
    if (!this.loaded.has(id)) {
      try {
        await this.load(row);
      } catch (err) {
        await this.prisma.installedExtension.update({ where: { id }, data: { enabled: false, lastError: shortError(err) } });
        throw new BadRequestException(`A extensão não arrancou: ${shortError(err)}`);
      }
    }
    await this.prisma.installedExtension.update({ where: { id }, data: { enabled: true, disabledReason: null, lastError: null, consecutiveFailures: 0 } });
    await this.audit.record({ action: "extension.enabled", actorId, targetType: "extension", targetId: id });
    return this.view(id);
  }

  async disable(id: string, actorId: string) {
    const exists = await this.prisma.installedExtension.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException("Extensão não encontrada");
    await this.unload(id);
    await this.prisma.installedExtension.update({ where: { id }, data: { enabled: false, disabledReason: null } });
    await this.audit.record({ action: "extension.disabled", actorId, targetType: "extension", targetId: id });
    return this.view(id);
  }

  /** Desligada sem ser à mão (disjuntor, erro ao arrancar, ficheiros alterados): fica o motivo e o aviso. */
  private async markDisabled(id: string, reason: string) {
    await this.prisma.installedExtension.update({ where: { id }, data: { enabled: false, disabledReason: reason } });
    this.logger.error(`«${id}» desligada: ${reason}`);
    await this.audit.record({ action: "extension.disabled_automatically", targetType: "extension", targetId: id, metadata: { reason } });
    this.realtime.emit("extensions", "disabled");
  }

  // ---------------------------------------------------------------------------------------------------- carregar

  /** Esquece o código carregado desta extensão (para a próxima vez se ler o que está no disco). */
  private forgetCode(id: string) {
    const dir = this.folderOf(id) + path.sep;
    for (const key of Object.keys(require.cache)) if (key.startsWith(dir)) delete require.cache[key];
  }

  private async load(row: InstalledExtension) {
    const manifest = row.manifest as unknown as ExtensionManifest;
    if (this.currentChecksum(row.id) !== row.approvedChecksum) throw new Error("Os ficheiros mudaram depois de aprovada: aprova de novo");
    // A contagem do disjuntor recomeça sempre que a extensão é carregada (ligar à mão ou arrancar).
    const loaded: Loaded = { handlers: new Map(), failures: 0 };
    if (manifest.server) {
      const folder = this.folderOf(row.id);
      const entry = path.resolve(folder, manifest.server);
      if (path.relative(folder, entry).startsWith("..")) throw new Error("server fora da pasta da extensão");
      this.forgetCode(row.id);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const exported = require(entry) as Partial<ExtensionModule> & { default?: Partial<ExtensionModule> };
      const mod = typeof exported.activate === "function" ? exported : exported.default;
      if (!mod || typeof mod.activate !== "function") throw new Error("O server não exporta activate(contexto)");
      let active = true;
      const ctx = this.context(row.id, manifest.version, loaded, () => active);
      try {
        const result = (await withTimeout(mod.activate(ctx), this.timeoutMs(), "activate")) as ActivatedExtension | void;
        if (result && typeof result.deactivate === "function") {
          const deactivate = result.deactivate.bind(result);
          loaded.deactivate = async () => {
            active = false;
            await deactivate();
          };
        } else loaded.deactivate = () => void (active = false);
      } catch (err) {
        active = false;
        this.forgetCode(row.id);
        throw err;
      }
    }
    this.loaded.set(row.id, loaded);
    this.logger.log(`«${row.id}» ${manifest.version} ligada`);
  }

  private async unload(id: string) {
    const loaded = this.loaded.get(id);
    if (!loaded) return;
    this.loaded.delete(id);
    try {
      await withTimeout(loaded.deactivate?.(), this.timeoutMs(), "deactivate");
    } catch (err) {
      this.logger.warn(`«${id}» deactivate: ${shortError(err)}`);
    }
    this.forgetCode(id);
  }

  /** O contexto (o «SDK», sdk.ts): a forma suportada de uma extensão falar com o CRM. */
  private context(id: string, version: string, loaded: Loaded, isActive: () => boolean): ExtensionContext {
    const logger = new Logger(`Extensão ${id}`);
    const readState = async () => ((await this.prisma.installedExtension.findUniqueOrThrow({ where: { id }, select: { state: true } })).state ?? {}) as Record<string, unknown>;
    return {
      id,
      version,
      settings: { get: () => this.settings.getFor(id) },
      state: {
        get: readState,
        set: async (patch) => {
          if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new Error("state.set precisa de um objeto");
          await this.prisma.installedExtension.update({ where: { id }, data: { state: { ...(await readState()), ...patch } as Prisma.InputJsonValue } });
        },
      },
      events: {
        on: (type, handler) => {
          if (!isActive()) throw new Error("A extensão já foi desligada");
          if (typeof type !== "string" || typeof handler !== "function") throw new Error("events.on(tipo, função)");
          loaded.handlers.set(type, [...(loaded.handlers.get(type) ?? []), handler]);
        },
      },
      log: { info: (m) => logger.log(String(m)), warn: (m) => logger.warn(String(m)), error: (m) => logger.error(String(m)) },
    };
  }

  // ------------------------------------------------------------------------------------------------------ eventos

  /** Entrega um evento a cada subscritor de cada extensão ligada. Nunca lança. */
  async dispatch(envelope: WebhookEnvelope) {
    for (const [id, loaded] of [...this.loaded.entries()]) {
      const handlers = [...(loaded.handlers.get(envelope.type) ?? []), ...(loaded.handlers.get("*") ?? [])];
      for (const handler of handlers) {
        if (this.loaded.get(id) !== loaded) break; // desligada entretanto
        try {
          await withTimeout(handler(envelope), this.timeoutMs(), `evento ${envelope.type}`);
          if (loaded.failures > 0) {
            loaded.failures = 0;
            await this.prisma.installedExtension.update({ where: { id }, data: { consecutiveFailures: 0 } }).catch(() => undefined);
          }
        } catch (err) {
          await this.recordFailure(id, loaded, shortError(err));
        }
      }
    }
  }

  private async recordFailure(id: string, loaded: Loaded, error: string) {
    loaded.failures++;
    this.logger.warn(`«${id}»: ${error}`);
    await this.prisma.installedExtension.update({ where: { id }, data: { consecutiveFailures: loaded.failures, lastError: error } }).catch(() => undefined);
    if (loaded.failures >= BREAKER_FAILURES && this.loaded.get(id) === loaded) {
      await this.unload(id);
      await this.markDisabled(id, `Desligada pelo disjuntor: ${loaded.failures} falhas seguidas. Última: ${error}`);
    }
  }

  // ---------------------------------------------------------------------------------------------------- página

  private status(row: InstalledExtension): Status {
    if (row.missing) return "missing";
    if (!row.approvedChecksum) return "pending";
    if (row.checksum !== row.approvedChecksum) return "changed";
    if (row.enabled && this.loaded.has(row.id)) return "enabled";
    return row.disabledReason ? "disabled_auto" : "disabled";
  }

  private toView(row: InstalledExtension & { approvedBy: { id: string; name: string } | null }) {
    const m = row.manifest as unknown as ExtensionManifest;
    return {
      id: row.id,
      name: m.name,
      description: m.description,
      version: row.version,
      status: this.status(row),
      checksum: row.checksum,
      approvedChecksum: row.approvedChecksum,
      approvedAt: row.approvedAt,
      approvedBy: row.approvedBy,
      server: m.server ?? null,
      dependsOn: m.dependsOn,
      permissions: m.permissions.map((p) => ({ permission: p, description: describePermission(p)! })),
      hasSettings: (m.settings ?? []).length > 0,
      subscriptions: [...(this.loaded.get(row.id)?.handlers.keys() ?? [])].sort(),
      consecutiveFailures: row.consecutiveFailures,
      lastError: row.lastError,
      disabledReason: row.disabledReason,
      discoveredAt: row.discoveredAt,
    };
  }

  async view(id: string) {
    const row = await this.prisma.installedExtension.findUnique({ where: { id }, include: { approvedBy: { select: { id: true, name: true } } } });
    if (!row) throw new NotFoundException("Extensão não encontrada");
    return this.toView(row);
  }

  async list() {
    const rows = await this.prisma.installedExtension.findMany({ orderBy: { id: "asc" }, include: { approvedBy: { select: { id: true, name: true } } } });
    return { directory: this.directory(), extensions: rows.map((r) => this.toView(r)), problems: this.problems };
  }

  /** Desligadas sem ser à mão, para o aviso dos Administradores. */
  async alerts() {
    const rows = await this.prisma.installedExtension.findMany({ where: { enabled: false, disabledReason: { not: null }, missing: false }, orderBy: { id: "asc" } });
    return rows.map((r) => ({ id: r.id, name: (r.manifest as unknown as ExtensionManifest).name, reason: r.disabledReason }));
  }
}
