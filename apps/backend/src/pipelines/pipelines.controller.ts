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
import { PipelinesService } from "./pipelines.service";
import { CreatePipelineDto } from "./dto/create-pipeline.dto";
import { UpdatePipelineDto } from "./dto/update-pipeline.dto";
import { CreateStageDto } from "./dto/create-stage.dto";
import { UpdateStageDto } from "./dto/update-stage.dto";
import { ReorderStagesDto } from "./dto/reorder-stages.dto";

@UseGuards(JwtAuthGuard)
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

  @Post("pipelines")
  create(@Body() dto: CreatePipelineDto) {
    return this.pipelinesService.create(dto);
  }

  @Patch("pipelines/:id")
  update(@Param("id") id: string, @Body() dto: UpdatePipelineDto) {
    return this.pipelinesService.update(id, dto);
  }

  @Delete("pipelines/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string) {
    return this.pipelinesService.remove(id);
  }

  @Post("pipelines/:id/stages")
  addStage(@Param("id") id: string, @Body() dto: CreateStageDto) {
    return this.pipelinesService.addStage(id, dto);
  }

  @Patch("pipelines/:id/stages/reorder")
  reorderStages(@Param("id") id: string, @Body() dto: ReorderStagesDto) {
    return this.pipelinesService.reorderStages(id, dto);
  }

  @Patch("stages/:stageId")
  updateStage(@Param("stageId") stageId: string, @Body() dto: UpdateStageDto) {
    return this.pipelinesService.updateStage(stageId, dto);
  }

  @Delete("stages/:stageId")
  @HttpCode(HttpStatus.NO_CONTENT)
  removeStage(@Param("stageId") stageId: string) {
    return this.pipelinesService.removeStage(stageId);
  }
}
