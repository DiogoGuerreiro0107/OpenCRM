import { Prisma, PrismaClient } from "@prisma/client";
import { DEFAULT_WORK_ITEM_TYPE } from "../../work-item-types/system-types";

/**
 * Regras de automação do sistema (Fase 3b, docs/plano-fase-3-automacoes.md): comportamentos que antes estavam escritos no
 * código e passaram a regras editáveis e desativáveis. O arranque cria as que faltem (pela chave) e nunca altera as que
 * existem; não se apagam (voltavam no arranque seguinte).
 */
export const SYSTEM_AUTOMATION_RULES: Array<{ systemKey: string; data: Omit<Prisma.AutomationRuleCreateInput, "systemKey"> }> = [
  {
    // Era LeadsService.create: a lead nova cria a tarefa de primeiro contacto para o dia seguinte, para o responsável da
    // lead ou, sem ele, para quem a criou.
    systemKey: "lead.first_contact",
    data: {
      name: "Primeiro contacto da lead",
      entityType: "LEAD",
      trigger: "CREATED",
      triggerConfig: {},
      conditions: [],
      action: "CREATE_WORK_ITEM",
      actionConfig: { typeId: DEFAULT_WORK_ITEM_TYPE, title: "Contactar lead: {nome}", assignee: { mode: "OWNER" }, due: { amount: 1, unit: "days" } },
    },
  },
];

/** Cria as regras do sistema que faltem. Corre no arranque e depois de limpar a base de testes. */
export async function ensureSystemAutomationRules(prisma: Pick<PrismaClient, "automationRule">) {
  for (const rule of SYSTEM_AUTOMATION_RULES) {
    const exists = await prisma.automationRule.findUnique({ where: { systemKey: rule.systemKey }, select: { id: true } });
    if (!exists) {
      await prisma.automationRule.create({ data: { ...rule.data, systemKey: rule.systemKey } }).catch((err: { code?: string }) => {
        // Duas instâncias a arrancar ao mesmo tempo: a outra já a criou.
        if (err.code !== "P2002") throw err;
      });
    }
  }
}
