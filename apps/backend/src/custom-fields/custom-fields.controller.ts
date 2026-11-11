import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Audit } from "../audit/audit.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteRoles } from "../auth/decorators/roles.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { CustomFieldsService } from "./custom-fields.service";
import { CreateCustomFieldDto } from "./dto/create-custom-field.dto";
import { UpdateCustomFieldDto } from "./dto/update-custom-field.dto";
import { QueryCustomFieldsDto } from "./dto/query-custom-fields.dto";
import { UpsertCustomFieldValuesDto } from "./dto/upsert-custom-field-values.dto";

@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...WRITE_ACCESS.adminOnly)
@Controller("custom-fields")
export class CustomFieldsController {
  constructor(private readonly customFieldsService: CustomFieldsService) {}

  @Get()
  findAll(@Query() query: QueryCustomFieldsDto) {
    return this.customFieldsService.findAll(query);
  }

  @Audit("custom_field.created", { target: "custom_field", fields: ["entityType", "fieldLabel", "fieldType"] })
  @Post()
  create(@Body() dto: CreateCustomFieldDto) {
    return this.customFieldsService.create(dto);
  }

  @Audit("custom_field.updated", { target: "custom_field", fields: ["fieldLabel", "isRequired", "isVisible", "sortOrder"] })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCustomFieldDto) {
    return this.customFieldsService.update(id, dto);
  }

  @Audit("custom_field.deleted", { target: "custom_field" })
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.customFieldsService.remove(id);
  }

  @Get("values")
  getValues(@Query("entityType") entityType: QueryCustomFieldsDto["entityType"], @Query("entityId") entityId: string) {
    return this.customFieldsService.getValues(entityType, entityId);
  }

  // Preencher valores numa ficha é trabalho normal; só a DEFINIÇÃO dos campos é do Administrador.
  @WriteRoles(...WRITE_ACCESS.dailyWork)
  @Post("values")
  upsertValues(@Body() dto: UpsertCustomFieldValuesDto) {
    return this.customFieldsService.upsertValues(dto);
  }
}
