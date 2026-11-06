import { WRITE_ACCESS as backend } from "./permissions";
// O frontend mantém um espelho desta matriz só para esconder botões. Este teste garante que não divergem.
import { WRITE_ACCESS as frontend } from "../../../frontend/src/lib/permissions";

describe("matriz de permissões: backend e espelho do frontend", () => {
  const sorted = (roles: readonly string[]) => [...roles].sort();

  it("têm exatamente as mesmas áreas", () => {
    expect(Object.keys(frontend).sort()).toEqual(Object.keys(backend).sort());
  });

  it.each(Object.keys(backend))("área %s: mesmos papéis nos dois lados", (area) => {
    expect(sorted(frontend[area as keyof typeof frontend])).toEqual(sorted(backend[area as keyof typeof backend]));
  });
});
