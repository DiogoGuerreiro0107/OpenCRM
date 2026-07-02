import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { CompaniesModule } from "./companies/companies.module";
import { ContactsModule } from "./contacts/contacts.module";
import { ActivityLogModule } from "./activity-log/activity-log.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { DealsModule } from "./deals/deals.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    UsersModule,
    AuthModule,
    CompaniesModule,
    ContactsModule,
    ActivityLogModule,
    PipelinesModule,
    DealsModule,
  ],
})
export class AppModule {}
