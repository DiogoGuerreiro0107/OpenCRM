import type { ManagedUser, Role } from "@opencrm/shared-types";
import { api, setTokens } from "./api";

export interface CreateUserInput {
  name: string;
  email: string;
  role: Role;
  password: string;
}

export interface UpdateUserInput {
  name?: string;
  role?: Role;
  active?: boolean;
}

export async function listManagedUsers() {
  const { data } = await api.get<ManagedUser[]>("/users/manage");
  return data;
}

export async function createUser(input: CreateUserInput) {
  const { data } = await api.post<ManagedUser>("/users", input);
  return data;
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const { data } = await api.patch<ManagedUser>(`/users/${id}`, input);
  return data;
}

/** O Administrador define a password de outro utilizador. */
export async function setUserPassword(id: string, newPassword: string) {
  await api.post(`/users/${id}/password`, { newPassword });
}

/** O próprio utilizador altera a sua password. Devolve tokens novos: a sessão atual continua, as outras terminam. */
export async function changeOwnPassword(currentPassword: string, newPassword: string) {
  const { data } = await api.post<{ accessToken: string; refreshToken: string }>("/auth/change-password", {
    currentPassword,
    newPassword,
  });
  setTokens(data.accessToken, data.refreshToken);
}
