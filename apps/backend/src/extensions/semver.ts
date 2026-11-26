/**
 * Versões *semver* só nos formatos que os manifestos usam (Fase E1.1, docs/plano-fase-e1-extensoes.md): versões
 * `1.2.3` e intervalos `*`, `1.2.3` (exata), `^1.2.3`, `~1.2.3`, `>=1.2.3`. Sem pré-lançamentos (`1.0.0-beta`): são
 * recusados, em vez de comparados de forma aproximada.
 */

type Version = [number, number, number];

const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const RANGE = /^(\^|~|>=)?((?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8}))$/;

export function parseVersion(value: string): Version | null {
  const m = VERSION.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export const isVersion = (value: string) => parseVersion(value) !== null;

export const isRange = (value: string) => value === "*" || RANGE.test(value);

function compare(a: Version, b: Version) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/** O limite superior (exclusivo) de `^`: sobe o primeiro número que não é 0. `^0.2.3` → < 0.3.0; `^0.0.3` → < 0.0.4. */
function caretLimit([major, minor, patch]: Version): Version {
  if (major > 0) return [major + 1, 0, 0];
  if (minor > 0) return [0, minor + 1, 0];
  return [0, 0, patch + 1];
}

/** `version` está dentro de `range`? Versão ou intervalo inválidos → false. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  if (range === "*") return true;
  const m = RANGE.exec(range);
  if (!m) return false;
  const base = parseVersion(m[2])!;
  const op = m[1] ?? "";
  if (op === "") return compare(v, base) === 0;
  if (compare(v, base) < 0) return false;
  if (op === ">=") return true;
  const limit: Version = op === "^" ? caretLimit(base) : [base[0], base[1] + 1, 0];
  return compare(v, limit) < 0;
}
