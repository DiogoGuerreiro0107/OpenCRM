import { AutomationField, Condition, firstFailing } from "./conditions";
import { LoadedRecord } from "./automation-entities";

/**
 * Motor das automações (Fase 3a, docs/plano-fase-3-automacoes.md), sem dependências da base de dados (recebe-as em
 * `EngineDeps`), para se poder testar à parte. Para cada regra que interessa a um evento: âmbito → gatilho → condições →
 * proteção contra ciclos → ação, e o resultado fica no histórico.
 */

export interface EngineRule {
  id: string;
  name: string;
  entityType: string;
  workflowId: string | null;
  stepId: string | null;
  trigger: string;
  triggerConfig: Record<string, unknown>;
  conditions: Condition[];
  action: string;
  actionConfig: Record<string, unknown>;
}

export interface EngineEvent {
  entityType: string;
  entityId: string;
  trigger: string;
  changedFields?: string[];
  actorId?: string | null;
}

/** Cadeia de eventos causados uns pelos outros (uma ação pode gerar eventos que disparam outras regras). */
export interface Chain {
  depth: number;
  /** «regra:registo» que já correram nesta cadeia. */
  seen: Set<string>;
}

/** Profundidade máxima: uma pessoa (0) → automação (1) → automação (2) → automação (3). */
export const MAX_CHAIN_DEPTH = 3;

export const newChain = (): Chain => ({ depth: 0, seen: new Set() });

export interface RunRecord {
  ruleId: string;
  entityType: string;
  entityId: string;
  trigger: string;
  outcome: "SUCCEEDED" | "SKIPPED" | "FAILED";
  message: string;
  depth: number;
}

export interface EngineDeps {
  rulesFor: (entityType: string, trigger: string) => Promise<EngineRule[]>;
  load: (entityType: string, id: string) => Promise<LoadedRecord | null>;
  /** Campos das condições (inclui os personalizados «disponíveis em automações», lidos da base de dados). */
  fields: (entityType: string) => Promise<AutomationField[]>;
  /** Verificação própria do gatilho (ex.: o campo que mudou é o da regra). */
  matches: (rule: EngineRule, event: EngineEvent) => Promise<boolean>;
  /** Executa a ação; a cadeia serve para a ação despachar os eventos que causar. */
  execute: (rule: EngineRule, event: EngineEvent, chain: Chain, record: LoadedRecord) => Promise<string>;
  log: (run: RunRecord) => Promise<void>;
}

/**
 * Corre uma regra para um registo. `logSkips` = registar no histórico as condições não cumpridas (desligado nos gatilhos
 * agendados, que reavaliam os mesmos registos de hora a hora).
 */
export async function runRule(deps: EngineDeps, rule: EngineRule, event: EngineEvent, record: LoadedRecord, chain: Chain, logSkips: boolean) {
  // Âmbito: fora do fluxo ou do passo da regra, o evento não é com ela (nada no histórico).
  if (rule.workflowId && rule.workflowId !== record.workflowId) return;
  if (rule.stepId && rule.stepId !== record.stepId) return;
  if (!(await deps.matches(rule, event))) return;

  const base = { ruleId: rule.id, entityType: event.entityType, entityId: event.entityId, trigger: event.trigger, depth: chain.depth };
  const failing = rule.conditions.length > 0 ? firstFailing(await deps.fields(rule.entityType), record.values, rule.conditions) : null;
  if (failing) {
    if (logSkips) await deps.log({ ...base, outcome: "SKIPPED", message: failing });
    return;
  }
  if (chain.depth > MAX_CHAIN_DEPTH) {
    await deps.log({ ...base, outcome: "SKIPPED", message: `Cadeia de automações demasiado longa (mais de ${MAX_CHAIN_DEPTH} seguidas): parada para evitar ciclos` });
    return;
  }
  const key = `${rule.id}:${event.entityId}`;
  if (chain.seen.has(key)) {
    await deps.log({ ...base, outcome: "SKIPPED", message: "Esta regra já correu para este registo nesta cadeia: parada para evitar ciclos" });
    return;
  }
  chain.seen.add(key);
  try {
    const message = await deps.execute(rule, event, chain, record);
    await deps.log({ ...base, outcome: "SUCCEEDED", message });
  } catch (err) {
    await deps.log({ ...base, outcome: "FAILED", message: (err as Error).message || "Erro desconhecido" });
  }
}

/** Corre todas as regras ativas do tipo de registo e gatilho do evento. */
export async function runEvent(deps: EngineDeps, event: EngineEvent, chain: Chain = newChain()) {
  const rules = await deps.rulesFor(event.entityType, event.trigger);
  if (rules.length === 0) return;
  const record = await deps.load(event.entityType, event.entityId);
  if (!record) return;
  for (const rule of rules) {
    // Cada regra vê o registo como está agora (uma regra anterior pode tê-lo mudado).
    const current = rule === rules[0] ? record : ((await deps.load(event.entityType, event.entityId)) ?? record);
    await runRule(deps, rule, event, current, chain, true);
  }
}
