import { Module } from "@nestjs/common";
import { EmailService } from "./email.service";
import { EmailController } from "./email.controller";
import { MinioService } from "./minio.service";

@Module({
  controllers: [EmailController],
  providers: [EmailService, MinioService],
})
export class EmailModule {}
