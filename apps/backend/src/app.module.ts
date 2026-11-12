import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { SecretsModule } from "./common/secrets.module";
import { AuditModule } from "./audit/audit.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { PublicApiModule } from "./public-api/public-api.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { CompaniesModule } from "./companies/companies.module";
import { ContactsModule } from "./contacts/contacts.module";
import { TimelineModule } from "./timeline/timeline.module";
import { PipelinesModule } from "./pipelines/pipelines.module";
import { DealsModule } from "./deals/deals.module";
import { TasksModule } from "./tasks/tasks.module";
import { EmailModule } from "./email/email.module";
import { EmailTemplatesModule } from "./email-templates/email-templates.module";
import { LeadsModule } from "./leads/leads.module";
import { CustomFieldsModule } from "./custom-fields/custom-fields.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { AutomationsModule } from "./automations/automations.module";
import { ZadarmaModule } from "./zadarma/zadarma.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ModulesModule } from "./modules/modules.module";
import { RealtimeInterceptor } from "./realtime/realtime.interceptor";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // Limite global generoso (uso normal da UI faz dezenas de pedidos por minuto);
    // login e recuperação de password têm um limite estrito próprio (ver AuthController).
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 300 }]),
    PrismaModule,
    SecretsModule,
    AuditModule,
    ApiKeysModule,
    PublicApiModule,
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
    EmailTemplatesModule,
    LeadsModule,
    CustomFieldsModule,
    DashboardModule,
    AutomationsModule,
    ZadarmaModule,
    RealtimeModule,
    ModulesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Avisa os browsers ligados depois de qualquer escrita bem-sucedida (ver realtime/).
    { provide: APP_INTERCEPTOR, useClass: RealtimeInterceptor },
  ],
})
export class AppModule {}
