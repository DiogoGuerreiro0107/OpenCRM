import { SetMetadata } from "@nestjs/common";
import { ModuleId } from "./module-manifest";

export const MODULE_KEY = "requiredModule";

/**
 * Marca um controller (ou rota) como pertencente a um módulo opcional. Com o módulo desligado, o `ModuleGuard`
 * responde 404 (como se a rota não existisse). Todos os controllers têm de ser "núcleo" ou usar isto —
 * um teste estrutural (modules-coverage.spec.ts) falha se algum ficar sem decisão.
 */
export const RequireModule = (id: ModuleId) => SetMetadata(MODULE_KEY, id);
