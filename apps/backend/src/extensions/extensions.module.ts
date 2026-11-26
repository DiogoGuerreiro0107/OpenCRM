import { Module } from "@nestjs/common";
import { ExtensionsController } from "./extensions.controller";
import { ExtensionsService } from "./extensions.service";

/** Núcleo: o registo das extensões (Fase E1.1). */
@Module({
  controllers: [ExtensionsController],
  providers: [ExtensionsService],
})
export class ExtensionsModule {}
