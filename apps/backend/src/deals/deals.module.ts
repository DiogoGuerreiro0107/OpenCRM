import { Module } from "@nestjs/common";
import { DealsService } from "./deals.service";
import { DealsController } from "./deals.controller";
import { AutomationsModule } from "../automations/automations.module";

@Module({
  imports: [AutomationsModule],
  controllers: [DealsController],
  providers: [DealsService],
})
export class DealsModule {}
