import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CustomFieldsService } from "./custom-fields.service";
import { CreateCustomFieldDto } from "./dto/create-custom-field.dto";
import { UpdateCustomFieldDto } from "./dto/update-custom-field.dto";
import { QueryCustomFieldsDto } from "./dto/query-custom-fields.dto";
import { UpsertCustomFieldValuesDto } from "./dto/upsert-custom-field-values.dto";

@UseGuards(JwtAuthGuard)
@Controller("custom-fields")
export class CustomFieldsController {
  constructor(private readonly customFieldsService: CustomFieldsService) {}

  @Get()
  findAll(@Query() query: QueryCustomFieldsDto) {
    return this.customFieldsService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateCustomFieldDto) {
    return this.customFieldsService.create(dto);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateCustomFieldDto) {
    return this.customFieldsService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.customFieldsService.remove(id);
  }

  @Get("values")
  getValues(@Query("entityType") entityType: QueryCustomFieldsDto["entityType"], @Query("entityId") entityId: string) {
    return this.customFieldsService.getValues(entityType, entityId);
  }

  @Post("values")
  upsertValues(@Body() dto: UpsertCustomFieldValuesDto) {
    return this.customFieldsService.upsertValues(dto);
  }
}
