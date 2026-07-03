import { Module } from "@nestjs/common";
import { ZadarmaService } from "./zadarma.service";
import { ZadarmaController } from "./zadarma.controller";

@Module({
  controllers: [ZadarmaController],
  providers: [ZadarmaService],
})
export class ZadarmaModule {}
