import { SetMetadata } from "@nestjs/common";
import { Role } from "@prisma/client";
import type { WriteArea as WriteAreaName } from "../permissions";

export const ROLES_KEY = "roles";
export const WRITE_ROLES_KEY = "writeRoles";

/**
 * Restringe TODOS os métodos (leitura e escrita) aos papéis indicados.
 * Também conta como política de escrita da rota.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Define que papéis podem ALTERAR dados (POST/PATCH/PUT/DELETE). Não afeta a leitura.
 * Aplica-se a uma classe (todas as rotas) ou a um método (que sobrepõe a classe).
 * Uma rota de escrita sem política é recusada (ver RolesGuard) — falha segura.
 */
export const WriteRoles = (...roles: Role[]) => SetMetadata(WRITE_ROLES_KEY, roles);

export const WRITE_AREA_KEY = "writeArea";

/**
 * Política de escrita CONFIGURÁVEL (Fase 0d): os papéis vêm do PermissionsService em cada pedido (predefinição em
 * auth/permissions.ts, alterável pelo Administrador). Como @WriteRoles, aplica-se à classe ou ao método, e o do
 * método sobrepõe-se ao da classe (seja @WriteArea ou @WriteRoles).
 */
export const WriteArea = (area: WriteAreaName) => SetMetadata(WRITE_AREA_KEY, area);
