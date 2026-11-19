import { Module } from "@nestjs/common";
import { WorkItemTypesController } from "./work-item-types.controller";
import { WorkItemTypesService } from "./work-item-types.service";

@Module({
  controllers: [WorkItemTypesController],
  providers: [WorkItemTypesService],
  exports: [WorkItemTypesService],
})
export class WorkItemTypesModule {}
