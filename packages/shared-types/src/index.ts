export type Role = "ADMIN" | "GESTOR" | "COMERCIAL";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}
