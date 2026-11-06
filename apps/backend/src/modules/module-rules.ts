import { MODULE_MANIFESTS, ModuleId, ModuleManifest } from "./module-manifest";

/** Regras de dependência entre módulos — funções puras, sem base de dados, fáceis de testar. */

/** Dependências de `id` que NÃO estão ativas (impedem de o ligar). */
export function missingDependencies(
  id: ModuleId,
  enabled: ReadonlySet<ModuleId>,
  manifests: ModuleManifest[] = MODULE_MANIFESTS,
): ModuleId[] {
  const manifest = manifests.find((m) => m.id === id);
  return (manifest?.dependsOn ?? []).filter((dep) => !enabled.has(dep));
}

/** Módulos ATIVOS que dependem de `id` (impedem de o desligar). */
export function activeDependents(
  id: ModuleId,
  enabled: ReadonlySet<ModuleId>,
  manifests: ModuleManifest[] = MODULE_MANIFESTS,
): ModuleId[] {
  return manifests.filter((m) => m.dependsOn.includes(id) && enabled.has(m.id)).map((m) => m.id);
}

/** Problemas na própria lista de manifestos (dependências para módulos que não existem, ciclos, ids repetidos). */
export function manifestProblems(manifests: ModuleManifest[] = MODULE_MANIFESTS): string[] {
  const problems: string[] = [];
  const ids = manifests.map((m) => m.id);

  ids.forEach((id, index) => {
    if (ids.indexOf(id) !== index) problems.push(`id repetido: ${id}`);
  });
  for (const manifest of manifests) {
    for (const dep of manifest.dependsOn) {
      if (!ids.includes(dep)) problems.push(`${manifest.id} depende de "${dep}", que não existe`);
      if (dep === manifest.id) problems.push(`${manifest.id} depende de si próprio`);
    }
  }

  // Ciclos: um módulo não pode alcançar-se a si próprio seguindo dependências.
  const reaches = (from: ModuleId, target: ModuleId, seen: Set<ModuleId>): boolean => {
    const next = manifests.find((m) => m.id === from)?.dependsOn ?? [];
    return next.some((dep) => dep === target || (!seen.has(dep) && reaches(dep, target, new Set([...seen, dep]))));
  };
  for (const manifest of manifests) {
    if (reaches(manifest.id, manifest.id, new Set())) problems.push(`ciclo de dependências a passar por ${manifest.id}`);
  }
  return problems;
}
