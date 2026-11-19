import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteRoles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { WorkItemTypesService } from "./work-item-types.service";
import { CreateWorkItemTypeDto, QueryWorkItemTypesDto, ReorderWorkItemTypesDto, UpdateWorkItemTypeDto } from "./dto/work-item-type.dto";

/** Tipos de tarefa: todos leem (os formulários precisam da lista); só o Administrador configura. */
@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...ADMIN_ONLY)
@Controller("work-item-types")
export class WorkItemTypesController {
  constructor(private readonly types: WorkItemTypesService) {}

  @Get()
  findAll(@Query() query: QueryWorkItemTypesDto) {
    return this.types.findAll(query.active === "true");
  }

  @Audit("work_item_type.created", { target: "work_item_type", fields: ["name", "icon", "color"] })
  @Post()
  create(@Body() dto: CreateWorkItemTypeDto) {
    return this.types.create(dto);
  }

  // Antes de ":id", para «order» não ser lido como um id.
  @Audit("work_item_type.reordered", { target: "work_item_type", fields: ["ids"] })
  @Patch("order")
  reorder(@Body() dto: ReorderWorkItemTypesDto) {
    return this.types.reorder(dto.ids);
  }

  @Audit("work_item_type.updated", { target: "work_item_type", fields: ["name", "icon", "color", "active", "showInMenu"] })
  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateWorkItemTypeDto) {
    return this.types.update(id, dto);
  }

  @Audit("work_item_type.workflow_added", { target: "work_item_type" })
  @Post(":id/workflow")
  addWorkflow(@Param("id") id: string) {
    return this.types.addWorkflow(id);
  }

  @Audit("work_item_type.workflow_removed", { target: "work_item_type" })
  @Delete(":id/workflow")
  removeWorkflow(@Param("id") id: string) {
    return this.types.removeWorkflow(id);
  }

  @Audit("work_item_type.deleted", { target: "work_item_type" })
  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.types.remove(id);
  }
}
