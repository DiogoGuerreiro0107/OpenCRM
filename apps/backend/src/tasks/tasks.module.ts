import { Module } from "@nestjs/common";
import { TasksService } from "./tasks.service";
import { TasksController } from "./tasks.controller";
import { AutomationsModule } from "../automations/automations.module";

@Module({
  imports: [AutomationsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
