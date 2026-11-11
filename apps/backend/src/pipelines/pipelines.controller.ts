import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { Audit } from "../audit/audit.decorator";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ModuleGuard } from "../modules/module.guard";
import { RequireModule } from "../modules/require-module.decorator";
import { WriteRoles } from "../auth/decorators/roles.decorator";
import { WRITE_ACCESS } from "../auth/permissions";
import { PipelinesService } from "./pipelines.service";
import { CreatePipelineDto } from "./dto/create-pipeline.dto";
import { UpdatePipelineDto } from "./dto/update-pipeline.dto";
import { CreateStageDto } from "./dto/create-stage.dto";
import { UpdateStageDto } from "./dto/update-stage.dto";
import { ReorderStagesDto } from "./dto/reorder-stages.dto";

@UseGuards(JwtAuthGuard, RolesGuard, ModuleGuard)
@RequireModule("deals")
@WriteRoles(...WRITE_ACCESS.adminOnly)
@Controller()
export class PipelinesController {
  constructor(private readonly pipelinesService: PipelinesService) {}

  @Get("pipelines")
  findAll() {
    return this.pipelinesService.findAll();
  }

  @Get("pipelines/:id")
  findOne(@Param("id") id: string) {
    return this.pipelinesService.findOne(id);
  }

  @Audit("pipeline.created", { target: "pipeline", fields: ["name"] })
  @Post("pipelines")
  create(@Body() dto: CreatePipelineDto) {
    return this.pipelinesService.create(dto);
  }

  @Audit("pipeline.updated", { target: "pipeline", fields: ["name"] })
  @Patch("pipelines/:id")
  update(@Param("id") id: string, @Body() dto: UpdatePipelineDto) {
    return this.pipelinesService.update(id, dto);
  }

  @Audit("pipeline.deleted", { target: "pipeline" })
  @Delete("pipelines/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.pipelinesService.remove(id);
  }

  @Audit("pipeline.stage_added", { target: "pipeline", fields: ["name", "type"] })
  @Post("pipelines/:id/stages")
  addStage(@Param("id") id: string, @Body() dto: CreateStageDto) {
    return this.pipelinesService.addStage(id, dto);
  }

  @Audit("pipeline.stages_reordered", { target: "pipeline" })
  @Patch("pipelines/:id/stages/reorder")
  reorderStages(@Param("id") id: string, @Body() dto: ReorderStagesDto) {
    return this.pipelinesService.reorderStages(id, dto);
  }

  @Audit("pipeline.stage_updated", { target: "stage", param: "stageId", fields: ["name", "type"] })
  @Patch("stages/:stageId")
  updateStage(@Param("stageId") stageId: string, @Body() dto: UpdateStageDto) {
    return this.pipelinesService.updateStage(stageId, dto);
  }

  @Audit("pipeline.stage_deleted", { target: "stage", param: "stageId" })
  @Delete("stages/:stageId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeStage(@Param("stageId") stageId: string) {
    return this.pipelinesService.removeStage(stageId);
  }
}
