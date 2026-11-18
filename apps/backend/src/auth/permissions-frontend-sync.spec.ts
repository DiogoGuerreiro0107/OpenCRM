import { WRITE_AREA_KEYS } from "./permissions";
// Desde a Fase 0d o frontend NÃO tem cópia dos papéis (pergunta ao backend em GET /me/permissions); só conhece os
// NOMES das áreas, para os usar em useCanWrite("..."). Este teste garante que os nomes coincidem.
import { WRITE_AREA_NAMES } from "../../../frontend/src/lib/permissions";

describe("áreas de permissões: backend e frontend", () => {
  it("têm exatamente os mesmos nomes", () => {
    expect([...WRITE_AREA_NAMES].sort()).toEqual([...WRITE_AREA_KEYS].sort());
  });
});
