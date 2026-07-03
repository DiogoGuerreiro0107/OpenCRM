import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import * as crypto from "crypto";
import axios from "axios";
import { CallDirection, ZadarmaAccount } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SaveZadarmaAccountDto } from "./dto/save-zadarma-account.dto";
import { MakeCallDto } from "./dto/make-call.dto";
import { QueryCallRecordsDto } from "./dto/query-call-records.dto";

const ZADARMA_API_BASE = "https://api.zadarma.com";

/**
 * Número de dígitos finais usados para comparar números de telefone com os
 * guardados em Contact/Company — evita falhar por diferenças de formatação
 * (indicativo do país, espaços, "+"), sem precisar de uma biblioteca de
 * normalização de números completa.
 */
const PHONE_MATCH_DIGITS = 9;

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "").slice(-PHONE_MATCH_DIGITS);
}

@Injectable()
export class ZadarmaService {
  private readonly logger = new Logger(ZadarmaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Nunca devolve apiKey/apiSecret — só o suficiente para a UI saber se já
   * está configurado e mostrar a extensão/estado. */
  async getAccount() {
    const account = await this.prisma.zadarmaAccount.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, callerExtension: true, active: true, lastSyncAt: true },
    });
    if (!account) return null;
    return { ...account, hasCredentials: true };
  }

  async saveAccount(dto: SaveZadarmaAccountDto) {
    const existing = await this.prisma.zadarmaAccount.findFirst();
    if (existing) {
      await this.prisma.zadarmaAccount.update({
        where: { id: existing.id },
        data: {
          apiKey: dto.apiKey || undefined,
          apiSecret: dto.apiSecret || undefined,
          callerExtension: dto.callerExtension,
          active: dto.active,
        },
      });
    } else {
      if (!dto.apiKey || !dto.apiSecret) {
        throw new BadRequestException("API key e API secret são obrigatórios na primeira configuração");
      }
      await this.prisma.zadarmaAccount.create({
        data: { apiKey: dto.apiKey, apiSecret: dto.apiSecret, callerExtension: dto.callerExtension, active: dto.active },
      });
    }
    return this.getAccount();
  }

  async listCallRecords(query: QueryCallRecordsDto) {
    return this.prisma.callRecord.findMany({
      where: { contactId: query.contactId, companyId: query.companyId },
      orderBy: { startedAt: "desc" },
    });
  }

  /** Inicia uma chamada "click-to-call": a Zadarma liga primeiro para a extensão
   * configurada e, quando atendida, liga automaticamente para o número indicado. */
  async makeCall(dto: MakeCallDto) {
    const account = await this.requireActiveAccount();
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

  /** Sincroniza o histórico de chamadas da Zadarma (polling periódico). */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncCallHistory() {
    const account = await this.prisma.zadarmaAccount.findFirst({ where: { active: true } });
    if (!account) return;

    const since = account.lastSyncAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const now = new Date();

    try {
      const data = await this.request(account, "GET", "/v1/statistics/", {
        start: this.formatZadarmaDate(since),
        end: this.formatZadarmaDate(now),
      });

      const calls = Array.isArray(data?.stats) ? data.stats : [];
      for (const call of calls) {
        await this.upsertCallRecord(call);
      }

      await this.prisma.zadarmaAccount.update({ where: { id: account.id }, data: { lastSyncAt: now } });
    } catch (err) {
      this.logger.warn(`Falha ao sincronizar histórico de chamadas da Zadarma: ${(err as Error).message}`);
    }
  }

  private async upsertCallRecord(call: Record<string, unknown>) {
    const externalId = String(call.pbx_call_id ?? call.call_id_with_rec ?? call.id ?? "");
    if (!externalId) return;

    const exists = await this.prisma.callRecord.findUnique({ where: { externalId } });
    if (exists) return;

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

  private async requireActiveAccount(): Promise<ZadarmaAccount> {
    const account = await this.prisma.zadarmaAccount.findFirst({ where: { active: true } });
    if (!account) throw new NotFoundException("Nenhuma conta Zadarma configurada");
    return account;
  }

  private formatZadarmaDate(date: Date) {
    return date.toISOString().slice(0, 19).replace("T", " ");
  }

  /**
   * Assinatura da API da Zadarma (HMAC), conforme a documentação pública:
   * https://zadarma.com/en/support/api/
   *   1. ordenar os parâmetros alfabeticamente e montar uma query string
   *   2. md5_params = md5(query string)
   *   3. assinatura = base64(hmac_sha1(caminho + query_string + md5_params, apiSecret))
   *   4. header Authorization: "{apiKey}:{assinatura}"
   *
   * NOTA: implementado a partir da documentação pública, sem uma conta real
   * para testar em produção — a confirmar/ajustar quando houver credenciais.
   */
  private async request(
    account: ZadarmaAccount,
    method: "GET" | "POST",
    path: string,
    params: Record<string, string>,
  ) {
    const sortedKeys = Object.keys(params).sort();
    const queryString = sortedKeys.map((key) => `${key}=${encodeURIComponent(params[key])}`).join("&");
    const md5Params = crypto.createHash("md5").update(queryString).digest("hex");
    const stringToSign = `${path}${queryString}${md5Params}`;
    const signature = crypto.createHmac("sha1", account.apiSecret).update(stringToSign).digest("base64");
    const authorization = `${account.apiKey}:${signature}`;

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
