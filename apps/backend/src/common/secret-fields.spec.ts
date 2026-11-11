import * as fs from "node:fs";
import * as path from "node:path";
import { SECRET_FIELD_EXCEPTIONS, SECRET_FIELDS } from "./secret-fields";
import { ENCRYPTED_FIELD_KEYS } from "./secrets-migration";

/**
 * Teste estrutural: um campo com nome de segredo no schema Prisma tem de estar cifrado (SECRET_FIELDS) ou ter uma
 * exceção justificada. Um segredo novo guardado em claro faz falhar o CI, como acontece com os controllers sem
 * decisão de permissões.
 */
const SCHEMA = fs.readFileSync(path.join(__dirname, "../../prisma/schema.prisma"), "utf8");
const SECRET_NAME = /password|secret|token|apikey/i;

function modelFields(): Array<{ model: string; field: string }> {
  const out: Array<{ model: string; field: string }> = [];
  for (const block of SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    for (const line of block[2].split(/\r?\n/)) {
      const match = line.match(/^\s+(\w+)\s+\w+/);
      if (match && !line.trim().startsWith("//") && !line.trim().startsWith("@@")) out.push({ model: block[1], field: match[1] });
    }
  }
  return out;
}

describe("segredos no schema Prisma", () => {
  const secretLike = modelFields().filter((f) => SECRET_NAME.test(f.field));
  const encrypted = new Set(SECRET_FIELDS.map((f) => `${f.model}.${f.field}`));

  it("encontra campos com nome de segredo (o teste não está vazio)", () => {
    expect(secretLike.length).toBeGreaterThan(3);
  });

  it.each(secretLike.map((f) => [`${f.model}.${f.field}`]))("%s está cifrado ou tem exceção justificada", (name) => {
    const covered = encrypted.has(name) || (name in SECRET_FIELD_EXCEPTIONS && SECRET_FIELD_EXCEPTIONS[name].length > 10);
    expect(covered).toBe(true);
  });

  it("cada campo cifrado existe no schema", () => {
    const all = new Set(modelFields().map((f) => `${f.model}.${f.field}`));
    for (const name of encrypted) expect(all.has(name)).toBe(true);
  });

  it("cada campo cifrado é tratado pelo comando de migração (secrets:encrypt)", () => {
    expect([...ENCRYPTED_FIELD_KEYS].sort()).toEqual([...encrypted].sort());
  });

  it("as exceções só apontam para campos que existem (não ficam exceções esquecidas)", () => {
    const all = new Set(modelFields().map((f) => `${f.model}.${f.field}`));
    for (const name of Object.keys(SECRET_FIELD_EXCEPTIONS)) expect(all.has(name)).toBe(true);
  });
});
