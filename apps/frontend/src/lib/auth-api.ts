import type { AuthUser } from "@opencrm/shared-types";
import { api } from "./api";

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export async function login(email: string, password: string) {
  const { data } = await api.post<LoginResponse>("/auth/login", { email, password });
  return data;
}

export async function fetchCurrentUser() {
  const { data } = await api.get<AuthUser>("/auth/me");
  return data;
}

export async function logoutRequest() {
  await api.post("/auth/logout");
}
