import { Global, Module } from "@nestjs/common";
import { ExtensionsController } from "./extensions.controller";
import { ExtensionsService } from "./extensions.service";
import { ExtensionSettingsService } from "./extension-settings.service";

/** Núcleo: o registo das extensões (E1.1) e as suas definições (E1.3). Global: as extensões leem as definições. */
@Global()
@Module({
  controllers: [ExtensionsController],
  providers: [ExtensionsService, ExtensionSettingsService],
  exports: [ExtensionSettingsService],
})
export class ExtensionsModule {}
