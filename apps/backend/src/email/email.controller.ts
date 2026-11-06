import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { InternalApiKeyGuard } from "../auth/guards/internal-api-key.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { WriteRoles } from "../auth/decorators/roles.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { EmailService } from "./email.service";
import { IngestEmailDto } from "./dto/ingest-email.dto";
import { QueryEmailMessagesDto } from "./dto/query-email-messages.dto";
import { SendEmailDto } from "./dto/send-email.dto";

@RequireModule("email")
@Controller("email")
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  /** O email-worker pergunta isto antes de se ligar ao IMAP: com o módulo desligado responde 404 (guard). */
  @SkipThrottle()
  @UseGuards(InternalApiKeyGuard, ModuleGuard)
  @Get("worker-status")
  workerStatus() {
    return { enabled: true };
  }

  // O email-worker pode enviar muitas mensagens seguidas numa sincronização inicial.
  @SkipThrottle()
  @UseGuards(InternalApiKeyGuard, ModuleGuard)
  @Post("ingest")
  ingest(@Body() dto: IngestEmailDto) {
    return this.emailService.ingest(dto);
  }

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @Get("messages")
  findAll(@Query() query: QueryEmailMessagesDto) {
    return this.emailService.findAll(query);
  }

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @Get("messages/:id")
  findOne(@Param("id") id: string) {
    return this.emailService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, ModuleGuard)
  @Get("attachments/:id/download")
  async getDownloadUrl(@Param("id") id: string) {
    const url = await this.emailService.getAttachmentDownloadUrl(id);
    return { url };
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
  @WriteRoles(...WRITE_ACCESS.sendEmail)
  @Post("send")
  send(@Body() dto: SendEmailDto) {
    return this.emailService.send(dto);
  }
}
