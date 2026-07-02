import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, "..", ".sync-state.json");

export function readLastUid() {
  if (!existsSync(STATE_FILE)) return 0;
  try {
    const data = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    return data.lastUid ?? 0;
  } catch {
    return 0;
  }
}

export function writeLastUid(uid) {
  writeFileSync(STATE_FILE, JSON.stringify({ lastUid: uid }, null, 2));
}
