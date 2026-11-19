import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { WriteRoles } from "../auth/decorators/roles.decorator";
import { ADMIN_ONLY } from "../auth/permissions";
import { Audit } from "../audit/audit.decorator";
import { WorkflowsService } from "./workflows.service";
import { CreateWorkflowStepDto, ReorderWorkflowStepsDto, UpdateWorkflowStepDto } from "./dto/workflow-step.dto";

/**
 * Rotas genéricas de fluxos (Fase 2b): os passos de qualquer tipo de registo com fluxos (negócios, tarefas...). Ler é
 * para todos; configurar é do Administrador. Um fluxo de um módulo desligado não existe (404). Os fluxos em si
 * criam-se e apagam-se pelo dono (funis em /pipelines, tipos de tarefa em /work-item-types/:id/workflow).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@WriteRoles(...ADMIN_ONLY)
@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get("workflows/:id")
  async findOne(@Param("id") id: string) {
    return this.workflows.findOneWithCounts(id, await this.workflows.entityTypeOfWorkflow(id));
  }

  @Audit("workflow.step_added", { target: "workflow", fields: ["name", "category", "outcome"] })
  @Post("workflows/:id/steps")
  async addStep(@Param("id") id: string, @Body() dto: CreateWorkflowStepDto) {
    const entityType = await this.workflows.entityTypeOfWorkflow(id);
    return this.workflows.addStep(id, entityType, { name: dto.name.trim(), category: dto.category ?? "OPEN", outcome: dto.outcome ?? null });
  }

  @Audit("workflow.steps_reordered", { target: "workflow" })
  @Patch("workflows/:id/steps/order")
  async reorder(@Param("id") id: string, @Body() dto: ReorderWorkflowStepsDto) {
    const entityType = await this.workflows.entityTypeOfWorkflow(id);
    await this.workflows.reorderSteps(id, entityType, dto.steps);
    return this.workflows.findOneWithCounts(id, entityType);
  }

  @Audit("workflow.step_updated", { target: "workflow_step", fields: ["name", "category", "outcome"] })
  @Patch("workflow-steps/:id")
  async updateStep(@Param("id") id: string, @Body() dto: UpdateWorkflowStepDto) {
    const entityType = await this.workflows.entityTypeOfStep(id);
    return this.workflows.updateStep(id, entityType, { ...dto, name: dto.name?.trim() });
  }

  @Audit("workflow.step_deleted", { target: "workflow_step" })
  @Delete("workflow-steps/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStep(@Param("id") id: string, @Query("moveTo") moveTo?: string) {
    await this.workflows.removeStep(id, await this.workflows.entityTypeOfStep(id), moveTo || undefined);
  }
}
