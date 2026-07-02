import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { InternalApiKeyGuard } from "../auth/guards/internal-api-key.guard";
import { EmailService } from "./email.service";
import { IngestEmailDto } from "./dto/ingest-email.dto";
import { QueryEmailMessagesDto } from "./dto/query-email-messages.dto";
import { SendEmailDto } from "./dto/send-email.dto";

@Controller("email")
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @UseGuards(InternalApiKeyGuard)
  @Post("ingest")
  ingest(@Body() dto: IngestEmailDto) {
    return this.emailService.ingest(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get("messages")
  findAll(@Query() query: QueryEmailMessagesDto) {
    return this.emailService.findAll(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get("messages/:id")
  findOne(@Param("id") id: string) {
    return this.emailService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get("attachments/:id/download")
  async getDownloadUrl(@Param("id") id: string) {
    const url = await this.emailService.getAttachmentDownloadUrl(id);
    return { url };
  }

  @UseGuards(JwtAuthGuard)
  @Post("send")
  send(@Body() dto: SendEmailDto) {
    return this.emailService.send(dto);
  }
}
