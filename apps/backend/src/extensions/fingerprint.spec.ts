import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fingerprint, FingerprintError } from "./fingerprint";
import { isSafeServerPath, manifestErrors } from "./manifest";

describe("impressão digital de uma pasta de extensão", () => {
  let dir: string;
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencrm-impressao-"));
    write("extension.json", "{}");
    write("lib/a.js", "a");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("estável e com contagens", () => {
    const first = fingerprint(dir);
    expect(first).toMatchObject({ files: 2, bytes: 3 });
    expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint(dir).checksum).toBe(first.checksum);
  });

  it("muda com o conteúdo, um ficheiro novo, apagado ou renomeado", () => {
    const base = fingerprint(dir).checksum;
    write("lib/a.js", "b");
    const changed = fingerprint(dir).checksum;
    expect(changed).not.toBe(base);
    write("lib/a.js", "a");
    expect(fingerprint(dir).checksum).toBe(base);
    write("lib/b.js", "");
    expect(fingerprint(dir).checksum).not.toBe(base);
    fs.rmSync(path.join(dir, "lib/b.js"));
    fs.renameSync(path.join(dir, "lib/a.js"), path.join(dir, "lib/c.js"));
    expect(fingerprint(dir).checksum).not.toBe(base);
  });

  it("separa caminho e conteúdo («ab»+«c» ≠ «a»+«bc»)", () => {
    fs.rmSync(path.join(dir, "lib"), { recursive: true });
    write("ab", "c");
    const one = fingerprint(dir).checksum;
    fs.rmSync(path.join(dir, "ab"));
    write("a", "bc");
    expect(fingerprint(dir).checksum).not.toBe(one);
  });

  it("recusa ligações simbólicas", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "opencrm-fora-"));
    try {
      try {
        fs.symlinkSync(outside, path.join(dir, "fora"), "junction");
      } catch {
        return; // sem permissão para criar ligações neste sistema
      }
      expect(() => fingerprint(dir)).toThrow(FingerprintError);
      expect(() => fingerprint(dir)).toThrow(/«fora» é uma ligação simbólica/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("campo server do manifesto", () => {
  it("caminhos seguros dentro da pasta", () => {
    for (const ok of ["index.js", "dist/index.js", "lib/sub/main.js", "a_b-c.1.js"]) expect({ ok, valid: isSafeServerPath(ok) }).toEqual({ ok, valid: true });
    for (const bad of ["../index.js", "lib/../../x.js", "/etc/x.js", "./index.js", "index.ts", "index", "C:\\x.js", "lib//x.js", ".hidden.js", "a".repeat(201) + ".js", 3]) {
      expect({ bad, valid: isSafeServerPath(bad) }).toEqual({ bad, valid: false });
    }
  });

  it("só nas instaladas, e opcional", () => {
    const base = { id: "x", name: "X", description: "Exemplo.", version: "1.0.0", sdk: "^1.0.0", dependsOn: {}, provides: [], permissions: [], defaultEnabled: false, settings: [] };
    expect(manifestErrors({ ...base, origin: "installed" })).toEqual([]);
    expect(manifestErrors({ ...base, origin: "installed", server: "dist/index.js" })).toEqual([]);
    expect(manifestErrors({ ...base, origin: "builtin", server: "index.js" })).toEqual(["«x»: server só existe nas extensões instaladas"]);
    expect(manifestErrors({ ...base, origin: "installed", server: "../fora.js" })).toEqual(["«x»: server tem de ser um ficheiro .js dentro da pasta da extensão (ex.: dist/index.js)"]);
  });
});
