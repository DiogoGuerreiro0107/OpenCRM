import { Module } from "@nestjs/common";
import { MenuSettingsController } from "./menu-settings.controller";
import { MenuSettingsService } from "./menu-settings.service";

/** Núcleo: preferências do menu principal (Fase 2c). */
@Module({
  controllers: [MenuSettingsController],
  providers: [MenuSettingsService],
})
export class MenuSettingsModule {}
