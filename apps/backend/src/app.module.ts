import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { CompaniesModule } from "./companies/companies.module";
import { ContactsModule } from "./contacts/contacts.module";
import { TimelineModule } from "./timeline/timeline.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { DealsModule } from "./deals/deals.module";
import { TasksModule } from "./tasks/tasks.module";
import { EmailModule } from "./email/email.module";
import { LeadsModule } from "./leads/leads.module";
import { CustomFieldsModule } from "./custom-fields/custom-fields.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { DashboardModule } from "./dashboard/dashboard.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    WebhooksModule,
    UsersModule,
    AuthModule,
    CompaniesModule,
    ContactsModule,
    TimelineModule,
    PipelinesModule,
    DealsModule,
    TasksModule,
    EmailModule,
    LeadsModule,
    CustomFieldsModule,
    DashboardModule,
  ],
})
export class AppModule {}
