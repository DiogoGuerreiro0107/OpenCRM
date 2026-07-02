import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { EmailTemplatesService } from "./email-templates.service";
import { CreateEmailTemplateDto } from "./dto/create-email-template.dto";
import { UpdateEmailTemplateDto } from "./dto/update-email-template.dto";

@UseGuards(JwtAuthGuard)
@Controller("email-templates")
export class EmailTemplatesController {
  constructor(private readonly emailTemplatesService: EmailTemplatesService) {}

  @Get()
  findAll() {
    return this.emailTemplatesService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.emailTemplatesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateEmailTemplateDto) {
    return this.emailTemplatesService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateEmailTemplateDto) {
    return this.emailTemplatesService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.emailTemplatesService.remove(id);
  }
}
