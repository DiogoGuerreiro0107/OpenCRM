import { isPermission } from "./permissions";
import { SettingField, settingFieldsErrors } from "./settings";
import { isRange, isVersion, satisfies } from "./semver";

/**
 * Manifesto de uma extensão (Fase E1.1, docs/plano-fase-e1-extensoes.md; formato no desenho, docs/plano-extensoes-e-api.md
 * §4). Os módulos que vêm no CRM são extensões «embutidas» com este mesmo manifesto; as instaladas (E1.4) trazem-no
 * num `extension.json`.
 */

/** Versão do contrato entre o núcleo e as extensões. Sobe quando esse contrato muda; as embutidas acompanham-na. */
export const SDK_VERSION = "1.0.0";

export type ExtensionOrigin = "builtin" | "installed";

export interface ExtensionManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  /** Intervalo de versões do SDK do núcleo que a extensão aceita. */
  sdk: string;
  origin: ExtensionOrigin;
  /** id da extensão → intervalo de versões. */
  dependsOn: Record<string, string>;
  /** Contratos que implementa (§5.1 do desenho). Ainda nenhum (E1.3 traz o primeiro). */
  provides: string[];
  /** O que declara precisar (vocabulário em permissions.ts). */
  permissions: string[];
  defaultEnabled: boolean;
  /** Definições (Fase E1.3): o núcleo gera o formulário, valida e guarda; os segredos ficam cifrados. */
  settings: SettingField[];
  /**
   * Só nas instaladas (Fase E1.4): o ficheiro JavaScript (CommonJS) com `activate(contexto)`, relativo à pasta da
   * extensão. Sem ele, a extensão só traz definições.
   */
  server?: string;
}

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Contratos que o núcleo conhece. Vazio por agora: um `provides` desconhecido é erro. */
export const KNOWN_CONTRACTS: readonly string[] = [];

const FIELDS: Record<keyof ExtensionManifest, true> = {
  id: true,
  name: true,
  description: true,
  version: true,
  sdk: true,
  origin: true,
  dependsOn: true,
  provides: true,
  permissions: true,
  defaultEnabled: true,
  settings: true,
  server: true,
};

/** Campos que podem faltar. */
const OPTIONAL_FIELDS = new Set<string>(["server"]);

/** Caminho relativo seguro para um ficheiro .js dentro da pasta da extensão (sem «..», sem começar por «/»). */
export const isSafeServerPath = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 200 &&
  /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*\.js$/.test(value) &&
  !value.split("/").some((part) => part === ".." || part === ".");

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Erros de UM manifesto (forma e valores), cada um com o caminho do campo. Lista vazia = válido. */
export function manifestErrors(value: unknown): string[] {
  if (!isPlainObject(value)) return ["o manifesto tem de ser um objeto"];
  const m = value as Record<string, unknown>;
  const at = typeof m.id === "string" && m.id ? `«${m.id}»` : "manifesto";
  const errors: string[] = [];
  const err = (field: string, message: string) => errors.push(`${at}: ${field} ${message}`);

  for (const key of Object.keys(m)) if (!(key in FIELDS)) err(key, "não é um campo do manifesto");
  for (const key of Object.keys(FIELDS)) if (!(key in m) && !OPTIONAL_FIELDS.has(key)) err(key, "é obrigatório");

  if ("id" in m && !(typeof m.id === "string" && m.id.length <= 50 && ID.test(m.id))) err("id", "tem de ter minúsculas, dígitos e hífens (até 50), a começar por uma letra");
  if ("name" in m && !isText(m.name, 80)) err("name", "tem de ter texto (até 80 caracteres)");
  if ("description" in m && !isText(m.description, 500)) err("description", "tem de ter texto (até 500 caracteres)");
  if ("version" in m && !(typeof m.version === "string" && isVersion(m.version))) err("version", "tem de ser uma versão como 1.2.3");
  if ("sdk" in m) {
    if (!(typeof m.sdk === "string" && isRange(m.sdk))) err("sdk", "tem de ser um intervalo de versões (ex.: ^1.0.0)");
    else if (!satisfies(SDK_VERSION, m.sdk)) err("sdk", `«${m.sdk}» não aceita a versão do núcleo (${SDK_VERSION})`);
  }
  if ("origin" in m && m.origin !== "builtin" && m.origin !== "installed") err("origin", "tem de ser builtin ou installed");
  if ("defaultEnabled" in m && typeof m.defaultEnabled !== "boolean") err("defaultEnabled", "tem de ser verdadeiro ou falso");

  if ("dependsOn" in m) {
    if (!isPlainObject(m.dependsOn)) err("dependsOn", "tem de ser um objeto { id: intervalo }");
    else
      for (const [dep, range] of Object.entries(m.dependsOn)) {
        if (!ID.test(dep)) err(`dependsOn.${dep}`, "não é um id de extensão");
        if (!(typeof range === "string" && isRange(range))) err(`dependsOn.${dep}`, "tem de ser um intervalo de versões");
        if (dep === m.id) err(`dependsOn.${dep}`, "não pode depender de si própria");
      }
  }
  const list = (field: "provides" | "permissions", valid: (s: string) => boolean, what: string) => {
    const v = m[field];
    if (!(field in m)) return;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return err(field, "tem de ser uma lista de textos");
    const seen = new Set<string>();
    for (const x of v as string[]) {
      if (seen.has(x)) err(field, `repete «${x}»`);
      seen.add(x);
      if (!valid(x)) err(field, `«${x}» não é ${what}`);
    }
  };
  list("provides", (s) => KNOWN_CONTRACTS.includes(s), "um contrato conhecido");
  list("permissions", isPermission, "uma permissão conhecida");
  if ("settings" in m) errors.push(...settingFieldsErrors(at, m.settings, m.permissions));
  if ("server" in m) {
    if (m.origin !== "installed") err("server", "só existe nas extensões instaladas");
    else if (!isSafeServerPath(m.server)) err("server", "tem de ser um ficheiro .js dentro da pasta da extensão (ex.: dist/index.js)");
  }
  return errors;
}

/**
 * Erros de um CONJUNTO de manifestos: cada um válido, ids únicos, dependências existentes e na versão certa, sem
 * ciclos. Lista vazia = o conjunto pode ser carregado.
 */
export function manifestSetErrors(manifests: unknown[]): string[] {
  const errors = manifests.flatMap(manifestErrors);
  if (errors.length) return errors;
  const all = manifests as ExtensionManifest[];
  const byId = new Map<string, ExtensionManifest>();
  for (const m of all) {
    if (byId.has(m.id)) errors.push(`«${m.id}»: id repetido`);
    byId.set(m.id, m);
  }
  for (const m of all) {
    for (const [dep, range] of Object.entries(m.dependsOn)) {
      const target = byId.get(dep);
      if (!target) errors.push(`«${m.id}»: depende de «${dep}», que não existe`);
      else if (!satisfies(target.version, range)) errors.push(`«${m.id}»: precisa de «${dep}» ${range}, e há a ${target.version}`);
    }
  }
  if (errors.length) return errors;

  // Ciclos: percorre as dependências; voltar a um id que ainda está no caminho é um ciclo.
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      errors.push(`dependências em ciclo: ${[...path.slice(path.indexOf(id)), id].join(" → ")}`);
      return;
    }
    state.set(id, "visiting");
    for (const dep of Object.keys(byId.get(id)!.dependsOn)) visit(dep, [...path, id]);
    state.set(id, "done");
  };
  for (const m of all) visit(m.id, []);
  return errors;
}
