import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MODULE_MANIFESTS } from "./module-manifest";
import { ModulesService } from "./modules.service";

function build(saved: Array<{ moduleId: string; enabled: boolean }> = []) {
  const rows = [...saved];
  const prisma = {
    moduleSetting: {
      findMany: jest.fn().mockImplementation(async () => rows.map((r) => ({ ...r, options: {}, updatedAt: new Date() }))),
      upsert: jest.fn().mockImplementation(async ({ where, update, create }) => {
        const existing = rows.find((r) => r.moduleId === where.moduleId);
        if (existing) Object.assign(existing, update);
        else rows.push(create);
      }),
    },
  };
  const service = new ModulesService(prisma as never);
  return { service, prisma };
}

describe("ModulesService", () => {
  it("sem nenhuma definição guardada, todos os módulos estão ativos", async () => {
    const { service } = build();
    await service.reload();
    expect(service.enabledIds().sort()).toEqual(MODULE_MANIFESTS.map((m) => m.id).sort());
  });

  it("respeita as definições guardadas e mantém os restantes por omissão", async () => {
    const { service } = build([{ moduleId: "zadarma", enabled: false }]);
    await service.reload();
    expect(service.isEnabled("zadarma")).toBe(false);
    expect(service.isEnabled("leads")).toBe(true);
  });

  it("um módulo desconhecido conta como desligado (nunca abre uma porta por engano)", async () => {
    const { service } = build();
    await service.reload();
    expect(service.isEnabled("nao-existe")).toBe(false);
    expect(service.isEnabled("")).toBe(false);
  });

  it("uma linha guardada para um módulo que já não existe é ignorada", async () => {
    const { service } = build([{ moduleId: "modulo-antigo", enabled: true }]);
    await service.reload();
    expect(service.enabledIds()).not.toContain("modulo-antigo");
  });

  describe("setEnabled", () => {
    it("desliga e a cache reflete-se de imediato", async () => {
      const { service } = build();
      await service.reload();
      const view = await service.setEnabled("leads", false);
      expect(service.isEnabled("leads")).toBe(false);
      expect(view.find((m) => m.id === "leads")?.enabled).toBe(false);
    });

    it("recusa desligar um módulo de que outro ativo depende e diz qual", async () => {
      const { service, prisma } = build();
      await service.reload();
      await expect(service.setEnabled("deals", false)).rejects.toThrow(/Automações/);
      await expect(service.setEnabled("deals", false)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.moduleSetting.upsert).not.toHaveBeenCalled();
      expect(service.isEnabled("deals")).toBe(true);
    });

    it("depois de desligar o dependente já se pode desligar a dependência", async () => {
      const { service } = build();
      await service.reload();
      await service.setEnabled("automations", false);
      await service.setEnabled("deals", false);
      expect(service.isEnabled("deals")).toBe(false);
    });

    it("recusa ligar um módulo cuja dependência está desligada e diz qual", async () => {
      const { service } = build([
        { moduleId: "automations", enabled: false },
        { moduleId: "deals", enabled: false },
      ]);
      await service.reload();
      await expect(service.setEnabled("automations", true)).rejects.toThrow(/Funis e negócios/);
      expect(service.isEnabled("automations")).toBe(false);
    });

    it("módulo inexistente dá 404", async () => {
      const { service } = build();
      await service.reload();
      await expect(service.setEnabled("fantasma", true)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("ligar um módulo que já está ligado é inofensivo", async () => {
      const { service } = build();
      await service.reload();
      await expect(service.setEnabled("leads", true)).resolves.toBeDefined();
      expect(service.isEnabled("leads")).toBe(true);
    });
  });

  it("list() mostra as dependências e os dependentes ativos", async () => {
    const { service } = build();
    await service.reload();
    const view = service.list();
    expect(view.find((m) => m.id === "automations")?.dependsOn).toEqual(["deals"]);
    expect(view.find((m) => m.id === "deals")?.activeDependents).toEqual(["automations"]);
    expect(view.find((m) => m.id === "leads")?.activeDependents).toEqual([]);
  });
});
