import { SetMetadata } from "@nestjs/common";
import { Role } from "@prisma/client";

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
