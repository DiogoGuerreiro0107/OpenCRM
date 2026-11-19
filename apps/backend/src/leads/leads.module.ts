import { Module } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { LeadsController } from "./leads.controller";
import { AutomationsModule } from "../automations/automations.module";

@Module({
  imports: [AutomationsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
