import { MODULE_MANIFESTS, ModuleManifest } from "../modules/module-manifest";
import { ExtensionManifest, SDK_VERSION } from "./manifest";

/**
 * Os módulos que vêm no CRM, como extensões embutidas (Fase E1.1). Uma só fonte de verdade: derivados de
 * `MODULE_MANIFESTS`, que o resto do código continua a usar. Acompanham a versão do núcleo.
 */
export function builtinManifest(m: ModuleManifest): ExtensionManifest {
  return {
    id: m.id,
    name: m.label,
    description: m.description,
    version: SDK_VERSION,
    sdk: `^${SDK_VERSION}`,
    origin: "builtin",
    dependsOn: Object.fromEntries(m.dependsOn.map((dep) => [dep, `^${SDK_VERSION}`])),
    provides: [],
    permissions: m.permissions,
    defaultEnabled: m.defaultEnabled,
    settings: m.settings ?? [],
  };
}

export const BUILTIN_EXTENSIONS: ExtensionManifest[] = MODULE_MANIFESTS.map(builtinManifest);
