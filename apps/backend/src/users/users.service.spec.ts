import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { UsersService } from "./users.service";

type UserRow = { id: string; role: string; active: boolean; email?: string };

function build(target: UserRow | null, otherActiveAdmins = 1) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(target),
      count: jest.fn().mockResolvedValue(otherActiveAdmins),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: "novo", ...data })),
      update: jest.fn().mockImplementation(async ({ data }) => ({ id: "x", ...data })),
    },
  };
  return { service: new UsersService(prisma as never), prisma };
}

describe("UsersService.createUser", () => {
  const dto = { name: "  Ana  ", email: "  Ana@Globaltoner.PT ", role: "COMERCIAL" as const, password: "uma-password-boa" };

  it("normaliza o email, apara o nome e guarda só o hash da password", async () => {
    const { service, prisma } = build(null);
    await service.createUser(dto);

    const { data, select } = prisma.user.create.mock.calls[0][0];
    expect(data.email).toBe("ana@globaltoner.pt");
    expect(data.name).toBe("Ana");
    expect(data.passwordHash).not.toBe(dto.password);
    expect(await bcrypt.compare(dto.password, data.passwordHash)).toBe(true);
    expect(data).not.toHaveProperty("password");
    // a resposta nunca pode incluir hashes nem tokens
    expect(Object.keys(select).sort()).toEqual(["active", "createdAt", "email", "id", "name", "role"]);
  });

  it("email duplicado dá 409 em vez de um erro interno", async () => {
    const { service, prisma } = build(null);
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "5" }),
    );
    await expect(service.createUser(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it("outros erros não são disfarçados de 409", async () => {
    const { service, prisma } = build(null);
    const boom = new Error("ligação perdida");
    prisma.user.create.mockRejectedValue(boom);
    await expect(service.createUser(dto)).rejects.toBe(boom);
  });
});

describe("UsersService.updateUser — proteções", () => {
  it("utilizador inexistente dá 404", async () => {
    const { service } = build(null);
    await expect(service.updateUser("admin", "x", { name: "N" })).rejects.toBeInstanceOf(NotFoundException);
  });

  it("não podes desativar a tua própria conta", async () => {
    const { service, prisma } = build({ id: "eu", role: "ADMINISTRADOR", active: true });
    await expect(service.updateUser("eu", "eu", { active: false })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("não podes mudar o teu próprio papel", async () => {
    const { service } = build({ id: "eu", role: "ADMINISTRADOR", active: true });
    await expect(service.updateUser("eu", "eu", { role: "COMERCIAL" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("podes mudar o teu próprio nome e manter o mesmo papel", async () => {
    const { service, prisma } = build({ id: "eu", role: "ADMINISTRADOR", active: true });
    await service.updateUser("eu", "eu", { name: "Novo Nome", role: "ADMINISTRADOR", active: true });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("não deixa desativar o último Administrador ativo (mesmo por outra via)", async () => {
    const { service, prisma } = build({ id: "alvo", role: "ADMINISTRADOR", active: true }, 0);
    await expect(service.updateUser("outro", "alvo", { active: false })).rejects.toThrow(/pelo menos um Administrador/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("não deixa despromover o último Administrador ativo", async () => {
    const { service } = build({ id: "alvo", role: "ADMINISTRADOR", active: true }, 0);
    await expect(service.updateUser("outro", "alvo", { role: "COMERCIAL" })).rejects.toThrow(/pelo menos um Administrador/);
  });

  it("deixa despromover um Administrador quando existe outro ativo", async () => {
    const { service, prisma } = build({ id: "alvo", role: "ADMINISTRADOR", active: true }, 1);
    await service.updateUser("outro", "alvo", { role: "COMERCIAL" });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("desativar um utilizador que não é Administrador não conta Administradores", async () => {
    const { service, prisma } = build({ id: "alvo", role: "COMERCIAL", active: true }, 0);
    await service.updateUser("admin", "alvo", { active: false });
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it("desativar termina a sessão (apaga o refresh token); reativar não mexe nele", async () => {
    const off = build({ id: "alvo", role: "COMERCIAL", active: true });
    await off.service.updateUser("admin", "alvo", { active: false });
    expect(off.prisma.user.update.mock.calls[0][0].data).toMatchObject({ active: false, refreshToken: null });

    const on = build({ id: "alvo", role: "COMERCIAL", active: false });
    await on.service.updateUser("admin", "alvo", { active: true });
    expect(on.prisma.user.update.mock.calls[0][0].data).not.toHaveProperty("refreshToken");
  });
});

describe("UsersService.setPasswordByAdmin", () => {
  it("utilizador inexistente dá 404", async () => {
    const { service } = build(null);
    await expect(service.setPasswordByAdmin("x", "nova-password-ok")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("guarda só o hash e termina as sessões do utilizador", async () => {
    const { service, prisma } = build({ id: "u1", role: "COMERCIAL", active: true });
    await service.setPasswordByAdmin("u1", "nova-password-ok");

    const { data } = prisma.user.update.mock.calls[0][0];
    expect(await bcrypt.compare("nova-password-ok", data.passwordHash)).toBe(true);
    expect(data).toMatchObject({ refreshToken: null, resetToken: null });
  });
});
