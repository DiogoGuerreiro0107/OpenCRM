import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { JobsService } from "../jobs/jobs.service";
import { JobOutcome } from "../jobs/job-catalog";
import axios from "axios";
import { CallDirection } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { KeyField, orderByKey, readPage } from "../common/pagination";
import { MakeCallDto } from "./dto/make-call.dto";
import { QueryCallRecordsDto } from "./dto/query-call-records.dto";
import { normalizePhone, signZadarmaRequest } from "./zadarma.utils";
import { ModulesService } from "../modules/modules.service";
import { SecretsService } from "../common/secrets.service";
import { ExtensionSettingsService, settingSecretContext } from "../extensions/extension-settings.service";

const ZADARMA_API_BASE = "https://api.zadarma.com";

/** As credenciais, das definições da extensão (Fase E1.3). */
interface ZadarmaCredentials {
  apiKey: string;
  apiSecret: string;
  callerExtension: string | null;
}

/** Mais recente primeiro (startedAt, id): cursor e ordem das chamadas. */
const CALLS_RECENT_FIRST: KeyField[] = [
  { field: "startedAt", dir: "desc", kind: "date" },
  { field: "id", dir: "desc", kind: "string" },
];

@Injectable()
export class ZadarmaService implements OnModuleInit {
  private readonly logger = new Logger(ZadarmaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModulesService,
    private readonly secrets: SecretsService,
    private readonly settings: ExtensionSettingsService,
    jobs: JobsService,
  ) {
    jobs.handle("zadarma.sync", () => this.syncCallHistory());
  }

  async onModuleInit() {
    await this.migrateLegacyAccount();
  }

  /**
   * Fase E1.3: a conta da tabela antiga (`ZadarmaAccount`) passa para as definições da extensão, uma vez, só se as
   * definições ainda não tiverem credenciais. O segredo é decifrado com o contexto antigo e cifrado com o novo. Nunca
   * impede o arranque: um erro (p. ex. a chave dos segredos errada) fica no registo e a cópia tenta-se no arranque
   * seguinte. Devolve se copiou.
   */
  async migrateLegacyAccount(): Promise<boolean> {
    try {
      // As opções têm de estar carregadas (a ordem de arranque dos módulos não o garante): senão a cópia podia
      // gravar por cima de definições que já existem.
      await this.modules.reload();
      const options = this.modules.getOptions("zadarma");
      if (typeof options.apiKey === "string" && options.apiKey !== "") return false;
      const legacy = await this.prisma.zadarmaAccount.findFirst({ orderBy: { createdAt: "desc" } });
      if (!legacy) return false;
      const secret = this.secrets.decrypt(legacy.apiSecret, "ZadarmaAccount.apiSecret");
      await this.modules.setOptions("zadarma", {
        apiKey: legacy.apiKey,
        apiSecret: this.secrets.encrypt(secret, settingSecretContext("zadarma", "apiSecret")),
        callerExtension: legacy.callerExtension ?? null,
        active: legacy.active,
      });
      if (legacy.lastSyncAt) await this.modules.setState("zadarma", { lastSyncAt: legacy.lastSyncAt.toISOString() });
      this.logger.log("A conta da Zadarma passou para as definições da extensão (Fase E1.3).");
      return true;
    } catch (err) {
      this.logger.error(`Não foi possível passar a conta da Zadarma para as definições: ${(err as Error).message}`);
      return false;
    }
  }

  /** As credenciais, se a conta estiver configurada e ativa. */
  private credentials(): ZadarmaCredentials | null {
    const s = this.settings.get("zadarma");
    if (!s.active || typeof s.apiKey !== "string" || typeof s.apiSecret !== "string") return null;
    return { apiKey: s.apiKey, apiSecret: s.apiSecret, callerExtension: typeof s.callerExtension === "string" ? s.callerExtension : null };
  }

  async listCallRecords(query: QueryCallRecordsDto) {
    const where = { contactId: query.contactId, companyId: query.companyId };
    return readPage(CALLS_RECENT_FIRST, query, (after, take) =>
      this.prisma.callRecord.findMany({ where: after ? { AND: [where, after] } : where, orderBy: orderByKey(CALLS_RECENT_FIRST), take }),
    );
  }

  /** Inicia uma chamada "click-to-call": a Zadarma liga primeiro para a extensão
   * configurada e, quando atendida, liga automaticamente para o número indicado. */
  async makeCall(dto: MakeCallDto) {
    const account = this.credentials();
    if (!account) throw new NotFoundException("Nenhuma conta Zadarma configurada");
    if (!account.callerExtension) {
      throw new BadRequestException("Configura a tua extensão/número Zadarma nas definições antes de ligar");
    }

    try {
      await this.request(account, "GET", "/v1/request/callback/", {
        from: account.callerExtension,
        to: dto.phoneNumber,
      });
    } catch (err) {
      this.logger.warn(`Falha ao iniciar chamada via Zadarma: ${(err as Error).message}`);
      throw new BadRequestException("Não foi possível iniciar a chamada. Verifica as credenciais da Zadarma.");
    }
  }

  /**
   * Sincroniza o histórico de chamadas da Zadarma (tarefa «zadarma.sync», de 10 em 10 minutos). Uma falha da Zadarma
   * lança, para ficar no registo das tarefas (e, repetida, pôr a tarefa em pausa).
   */
  async syncCallHistory(): Promise<JobOutcome> {
    if (!this.modules.isEnabled("zadarma")) return { summary: "Módulo desligado", idle: true };
    const account = this.credentials();
    if (!account) return { summary: "Sem conta ativa", idle: true };

    const state = await this.modules.getState("zadarma");
    const since = typeof state.lastSyncAt === "string" ? new Date(state.lastSyncAt) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = new Date();

    try {
      const data = await this.request(account, "GET", "/v1/statistics/", {
        start: this.formatZadarmaDate(since),
        end: this.formatZadarmaDate(now),
      });

      const calls = Array.isArray(data?.stats) ? data.stats : [];
      let created = 0;
      for (const call of calls) {
        if (await this.upsertCallRecord(call)) created++;
      }

      await this.modules.setState("zadarma", { lastSyncAt: now.toISOString() });
      return { summary: `${created} ${created === 1 ? "chamada nova" : "chamadas novas"}`, idle: created === 0 };
    } catch (err) {
      this.logger.warn(`Falha ao sincronizar histórico de chamadas da Zadarma: ${(err as Error).message}`);
      throw new Error(`Falha ao sincronizar com a Zadarma: ${(err as Error).message}`);
    }
  }

  private async upsertCallRecord(call: Record<string, unknown>) {
    const externalId = String(call.pbx_call_id ?? call.call_id_with_rec ?? call.id ?? "");
    if (!externalId) return false;

    const exists = await this.prisma.callRecord.findUnique({ where: { externalId } });
    if (exists) return false;

    const fromNumber = String(call.from ?? "");
    const toNumber = String(call.to ?? "");
    const direction: CallDirection = call.direction === "in" ? "INBOUND" : "OUTBOUND";
    const otherPartyNumber = direction === "INBOUND" ? fromNumber : toNumber;

    const { contactId, companyId } = await this.matchPhoneNumber(otherPartyNumber);

    await this.prisma.callRecord.create({
      data: {
        externalId,
        direction,
        fromNumber,
        toNumber,
        duration: Number(call.duration ?? 0),
        disposition: call.disposition ? String(call.disposition) : null,
        recordingUrl: call.recording_url ? String(call.recording_url) : null,
        contactId,
        companyId,
        startedAt: call.call_start ? new Date(String(call.call_start)) : new Date(),
      },
    });
    return true;
  }

  private async matchPhoneNumber(phone: string): Promise<{ contactId?: string; companyId?: string }> {
    const normalized = normalizePhone(phone);
    if (!normalized) return {};

    const contacts = await this.prisma.contact.findMany({
      where: { OR: [{ phone: { not: null } }, { mobilePhone: { not: null } }] },
      select: { id: true, phone: true, mobilePhone: true, companyId: true },
    });
    const contact = contacts.find(
      (c) =>
        (c.phone && normalizePhone(c.phone) === normalized) ||
        (c.mobilePhone && normalizePhone(c.mobilePhone) === normalized),
    );
    if (contact) return { contactId: contact.id, companyId: contact.companyId ?? undefined };

    const companies = await this.prisma.company.findMany({
      where: { phone: { not: null } },
      select: { id: true, phone: true },
    });
    const company = companies.find((c) => c.phone && normalizePhone(c.phone) === normalized);
    if (company) return { companyId: company.id };

    return {};
  }

  private formatZadarmaDate(date: Date) {
    return date.toISOString().slice(0, 19).replace("T", " ");
  }

  /** Pedido assinado à API da Zadarma (algoritmo de assinatura em zadarma.utils.ts). */
  private async request(
    account: ZadarmaCredentials,
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
  ) {
    const { queryString, authorization } = signZadarmaRequest(account.apiKey, account.apiSecret, path, params);

    const url = `${ZADARMA_API_BASE}${path}${queryString ? `?${queryString}` : ""}`;
    const response = await axios.request({
      url,
      method,
      headers: { Authorization: authorization },
      timeout: 10000,
    });
    return response.data;
  }
}
