import { Global, Module } from "@nestjs/common";
import { WebhooksService } from "./webhooks.service";
import { WebhookDispatcher } from "./webhook-dispatcher.service";
import { WebhookSubscriptionsService } from "./webhook-subscriptions.service";
import { WebhooksController } from "./webhooks.controller";

/** Global: qualquer módulo publica eventos com `WebhooksService.trigger()`. Núcleo (não é opcional). */
@Global()
@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDispatcher, WebhookSubscriptionsService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
