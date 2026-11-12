import type {
  WebhookDeliveryView,
  WebhookEventInfo,
  WebhookSubscriptionView,
  WebhookSubscriptionWithSecret,
} from "@opencrm/shared-types";
import { api } from "./api";

export interface WebhookInput {
  name: string;
  url: string;
  events: string[];
}

export async function listWebhookEvents() {
  const { data } = await api.get<WebhookEventInfo[]>("/webhooks/events");
  return data;
}

export async function listWebhooks() {
  const { data } = await api.get<WebhookSubscriptionView[]>("/webhooks/subscriptions");
  return data;
}

/** A resposta traz o segredo de assinatura UMA única vez. */
export async function createWebhook(input: WebhookInput) {
  const { data } = await api.post<WebhookSubscriptionWithSecret>("/webhooks/subscriptions", input);
  return data;
}

export async function updateWebhook(id: string, input: Partial<WebhookInput> & { active?: boolean }) {
  const { data } = await api.patch<WebhookSubscriptionView>(`/webhooks/subscriptions/${id}`, input);
  return data;
}

export async function deleteWebhook(id: string) {
  await api.delete(`/webhooks/subscriptions/${id}`);
}

export async function rotateWebhookSecret(id: string) {
  const { data } = await api.post<WebhookSubscriptionWithSecret>(`/webhooks/subscriptions/${id}/rotate-secret`);
  return data;
}

export async function sendWebhookTest(id: string) {
  await api.post(`/webhooks/subscriptions/${id}/test`);
}

export async function listWebhookDeliveries(subscriptionId: string) {
  const { data } = await api.get<{ items: WebhookDeliveryView[]; nextCursor: string | null }>("/webhooks/deliveries", {
    params: { subscriptionId, limit: 20 },
  });
  return data.items;
}

export async function redeliverWebhook(deliveryId: string) {
  await api.post(`/webhooks/deliveries/${deliveryId}/redeliver`);
}
