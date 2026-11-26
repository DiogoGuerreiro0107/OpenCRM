import { Global, Module } from "@nestjs/common";
import { ExtensionsController } from "./extensions.controller";
import { ExtensionsService } from "./extensions.service";
import { ExtensionSettingsService } from "./extension-settings.service";
import { InstalledExtensionsService } from "./installed-extensions.service";

/** Núcleo: o registo das extensões (E1.1), as definições (E1.3) e as instaladas da pasta (E1.4). Global: as extensões leem as definições. */
@Global()
@Module({
  controllers: [ExtensionsController],
  providers: [ExtensionsService, ExtensionSettingsService, InstalledExtensionsService],
  exports: [ExtensionSettingsService],
})
export class ExtensionsModule {}
