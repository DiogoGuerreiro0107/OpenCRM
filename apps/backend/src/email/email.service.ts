import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import { MinioService } from "./minio.service";
import { IngestEmailDto } from "./dto/ingest-email.dto";
import { QueryEmailMessagesDto } from "./dto/query-email-messages.dto";
import { SendEmailDto } from "./dto/send-email.dto";

const MESSAGE_INCLUDE = {
  attachments: true,
  contact: { select: { id: true, name: true } },
  company: { select: { id: true, name: true } },
};

@Injectable()
export class EmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  findAll(query: QueryEmailMessagesDto) {
    return this.prisma.emailMessage.findMany({
      where: {
        contactId: query.contactId,
        companyId: query.companyId,
      },
      orderBy: { sentAt: "desc" },
      include: MESSAGE_INCLUDE,
    });
  }

  async findOne(id: string) {
    const message = await this.prisma.emailMessage.findUnique({ where: { id }, include: MESSAGE_INCLUDE });
    if (!message) throw new NotFoundException("Mensagem não encontrada");
    return message;
  }

  async getAttachmentDownloadUrl(attachmentId: string) {
    const attachment = await this.prisma.attachment.findUnique({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException("Anexo não encontrado");
    return this.minio.getDownloadUrl(attachment.storageKey);
  }

  async ingest(dto: IngestEmailDto) {
    const account = await this.prisma.emailAccount.findUnique({ where: { email: dto.accountEmail } });
    if (!account) throw new NotFoundException("Conta de email não encontrada");

    const existing = await this.prisma.emailMessage.findUnique({ where: { messageId: dto.messageId } });
    if (existing) return existing;

    const { contactId, companyId } = await this.matchContactAndCompany([dto.fromAddress, ...dto.toAddresses]);

    return this.prisma.emailMessage.create({
      data: {
        accountId: account.id,
        direction: "INBOUND",
        messageId: dto.messageId,
        fromAddress: dto.fromAddress,
        fromName: dto.fromName,
        toAddresses: dto.toAddresses,
        subject: dto.subject,
        textBody: dto.textBody,
        htmlBody: dto.htmlBody,
        sentAt: new Date(dto.sentAt),
        contactId,
        companyId,
        attachments: dto.attachments?.length
          ? {
              create: dto.attachments.map((a) => ({
                filename: a.filename,
                mimeType: a.mimeType,
                size: a.size,
                storageKey: a.storageKey,
              })),
            }
          : undefined,
      },
      include: MESSAGE_INCLUDE,
    });
  }

  async send(dto: SendEmailDto) {
    const account = await this.prisma.emailAccount.findFirst();
    if (!account) throw new BadRequestException("Nenhuma conta de email configurada");

    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: { user: account.username, pass: account.password },
    });

    const info = await transporter.sendMail({
      from: account.email,
      to: dto.to,
      subject: dto.subject,
      text: dto.text,
    });

    const { contactId, companyId } =
      dto.contactId || dto.companyId
        ? { contactId: dto.contactId, companyId: dto.companyId }
        : await this.matchContactAndCompany(dto.to);

    return this.prisma.emailMessage.create({
      data: {
        accountId: account.id,
        direction: "OUTBOUND",
        messageId: info.messageId ?? `outbound-${Date.now()}@opencrm.local`,
        fromAddress: account.email,
        fromName: null,
        toAddresses: dto.to,
        subject: dto.subject,
        textBody: dto.text,
        sentAt: new Date(),
        contactId,
        companyId,
      },
      include: MESSAGE_INCLUDE,
    });
  }

  async sendRaw(to: string, subject: string, text: string) {
    const account = await this.prisma.emailAccount.findFirst();
    if (!account) throw new BadRequestException("Nenhuma conta de email configurada");

    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: { user: account.username, pass: account.password },
    });

    await transporter.sendMail({ from: account.email, to, subject, text });
  }

  private async matchContactAndCompany(addresses: string[]) {
    const normalized = addresses.map((a) => a.toLowerCase());
    const contact = await this.prisma.contact.findFirst({
      where: { email: { in: normalized, mode: "insensitive" } },
      select: { id: true, companyId: true },
    });
    return {
      contactId: contact?.id,
      companyId: contact?.companyId ?? undefined,
    };
  }
}
