import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { AutomationsModule } from "../automations/automations.module";
import { WorkItemTypesModule } from "../work-item-types/work-item-types.module";

@Module({
  imports: [AutomationsModule, WorkItemTypesModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
