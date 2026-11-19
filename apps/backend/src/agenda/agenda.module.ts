import { Module } from "@nestjs/common";
import { AgendaController } from "./agenda.controller";
import { AgendaService } from "./agenda.service";

/** Núcleo: agenda (Fase 2d). As fontes de módulos opcionais respeitam o módulo (src/agenda/agenda-sources.ts). */
@Module({
  controllers: [AgendaController],
  providers: [AgendaService],
})
export class AgendaModule {}
