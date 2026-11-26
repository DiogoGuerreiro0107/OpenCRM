import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Impressão digital de uma pasta de extensão (Fase E1.4): SHA-256 sobre o caminho relativo e o conteúdo de cada
 * ficheiro, por ordem. Qualquer ficheiro acrescentado, apagado, renomeado ou alterado muda-a. É ela que o
 * Administrador aprova; uma extensão com outra impressão digital não carrega.
 *
 * Recusa ligações simbólicas (podiam apontar para fora da pasta, e o código carregado seria outro) e pastas grandes
 * de mais (uma extensão empacota o que precisa; não é um sítio para dependências enormes).
 */

export const MAX_FILES = 2000;
export const MAX_BYTES = 20 * 1024 * 1024;

export class FingerprintError extends Error {}

export interface Fingerprint {
  checksum: string;
  files: number;
  bytes: number;
}

export function fingerprint(dir: string): Fingerprint {
  const entries: Array<{ rel: string; full: string }> = [];
  let bytes = 0;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join("/");
      if (entry.isSymbolicLink()) throw new FingerprintError(`«${rel}» é uma ligação simbólica (não são aceites)`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        entries.push({ rel, full });
        if (entries.length > MAX_FILES) throw new FingerprintError(`Mais de ${MAX_FILES} ficheiros`);
        bytes += fs.statSync(full).size;
        if (bytes > MAX_BYTES) throw new FingerprintError(`Mais de ${MAX_BYTES / 1024 / 1024} MB`);
      } else throw new FingerprintError(`«${rel}» não é um ficheiro nem uma pasta`);
    }
  };
  walk(dir);
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const hash = createHash("sha256");
  for (const { rel, full } of entries) {
    const content = fs.readFileSync(full);
    // Comprimentos antes de cada parte: «a» + «bc» nunca dá o mesmo que «ab» + «c».
    hash.update(`${Buffer.byteLength(rel)}:${rel}:${content.length}:`);
    hash.update(content);
  }
  return { checksum: hash.digest("hex"), files: entries.length, bytes };
}
