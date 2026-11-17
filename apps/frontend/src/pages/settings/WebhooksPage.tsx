import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WebhookDeliveryView, WebhookSubscriptionView } from "@opencrm/shared-types";
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhookEvents,
  listWebhooks,
  redeliverWebhook,
  rotateWebhookSecret,
  sendWebhookTest,
  updateWebhook,
} from "@/lib/webhooks-api";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-PT") : "—");

const DELIVERY_LABEL: Record<WebhookDeliveryView["status"], string> = { PENDING: "Na fila", DELIVERED: "Entregue", FAILED: "Falhada" };
const DELIVERY_CLASS: Record<WebhookDeliveryView["status"], string> = {
  PENDING: "border-amber-200 bg-amber-100 text-amber-800",
  DELIVERED: "border-green-200 bg-green-100 text-green-800",
  FAILED: "border-red-200 bg-red-100 text-red-800",
};

function Deliveries({ subscriptionId }: { subscriptionId: string }) {
  const queryClient = useQueryClient();
  const deliveries = useQuery({
    queryKey: ["webhooks", "deliveries", subscriptionId],
    queryFn: () => listWebhookDeliveries(subscriptionId),
    refetchInterval: 5000, // a fila avança sozinha (tentativas e repetições)
  });
  const redeliver = useMutation({
    mutationFn: (id: string) => redeliverWebhook(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks"] }),
  });

  if (deliveries.isLoading) return <p className="text-xs text-muted-foreground">A carregar entregas...</p>;
  if (deliveries.isError) return <p className="text-xs text-red-600">{errorMessage(deliveries.error, "Não foi possível carregar as entregas.")}</p>;
  if (!deliveries.data?.length) return <p className="text-xs text-muted-foreground">Ainda não houve entregas.</p>;

  return (
    <div className="overflow-x-auto">
      {redeliver.isError && <p className="mb-1 text-xs text-red-600">{errorMessage(redeliver.error, "Não foi possível reenviar.")}</p>}
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 pr-3">Quando</th>
            <th className="py-1 pr-3">Evento</th>
            <th className="py-1 pr-3">Estado</th>
            <th className="py-1 pr-3">Tentativas</th>
            <th className="py-1 pr-3">Resultado</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {deliveries.data.map((d) => (
            <tr key={d.id} className="border-t border-border/60">
              <td className="whitespace-nowrap py-1 pr-3">{formatDate(d.createdAt)}</td>
              <td className="py-1 pr-3">
                <code>{d.eventType}</code>
              </td>
              <td className="py-1 pr-3">
                <Badge className={DELIVERY_CLASS[d.status]}>{DELIVERY_LABEL[d.status]}</Badge>
              </td>
              <td className="py-1 pr-3">{d.attempts}</td>
              <td className="py-1 pr-3">
                {d.lastError ?? (d.lastStatusCode ? `HTTP ${d.lastStatusCode}` : "—")}
                {d.nextAttemptAt && <span className="block text-muted-foreground">Nova tentativa: {formatDate(d.nextAttemptAt)}</span>}
              </td>
              <td className="py-1 text-right">
                {d.status !== "PENDING" && (
                  <Button variant="outline" size="sm" disabled={redeliver.isPending} onClick={() => redeliver.mutate(d.id)}>
                    Reenviar
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-muted-foreground">Últimas 20 entregas.</p>
    </div>
  );
}

export function WebhooksPage() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["webhooks"] });
  const webhooks = useQuery({ queryKey: ["webhooks"], queryFn: listWebhooks });
  const events = useQuery({ queryKey: ["webhooks", "events"], queryFn: listWebhookEvents });

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [allEvents, setAllEvents] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "delete" | "rotate"; webhook: WebhookSubscriptionView } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createWebhook({ name: name.trim(), url: url.trim(), events: allEvents ? ["*"] : selected }),
    onSuccess: (created) => {
      setIsCreateOpen(false);
      setSecret({ title: "Webhook criado", value: created.secret });
      refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (w: WebhookSubscriptionView) => updateWebhook(w.id, { active: !w.active }),
    onSuccess: refresh,
  });
  const test = useMutation({
    mutationFn: (w: WebhookSubscriptionView) => sendWebhookTest(w.id),
    onSuccess: (_data, w) => {
      setNotice(`Evento de teste posto na fila de «${w.name}». Vê o resultado em «Entregas».`);
      setExpanded(w.id);
      refresh();
    },
  });
  const rotate = useMutation({
    mutationFn: (w: WebhookSubscriptionView) => rotateWebhookSecret(w.id),
    onSuccess: (rotated) => {
      setConfirm(null);
      setSecret({ title: "Novo segredo", value: rotated.secret });
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (w: WebhookSubscriptionView) => deleteWebhook(w.id),
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
  });

  function openCreate() {
    setName("");
    setUrl("");
    setAllEvents(false);
    setSelected([]);
    create.reset();
    setIsCreateOpen(true);
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.value);
      setCopied(true);
    } catch {
      setCopied(false); // sem permissão para a área de transferência: copia-se à mão
    }
  }

  const toggleEvent = (type: string) => setSelected((current) => (current.includes(type) ? current.filter((e) => e !== type) : [...current, type]));
  const actionError = toggle.error ?? test.error;
  const canCreate = name.trim() !== "" && url.trim() !== "" && (allEvents || selected.length > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Webhooks</h1>
          <p className="text-sm text-muted-foreground">
            O CRM avisa outros sistemas (n8n, loja online, faturação) quando algo acontece, chamando o endereço que indicares. Cada
            aviso vai <strong>assinado</strong> com um segredo, e se o destino estiver em baixo o CRM <strong>volta a tentar</strong>{" "}
            (até 6 vezes, ao longo de cerca de 9 horas).
          </p>
        </div>
        <Button onClick={openCreate}>Novo webhook</Button>
      </div>

      {notice && <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{notice}</p>}
      {actionError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage(actionError, "A operação falhou.")}</p>
      )}
      {webhooks.isError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage(webhooks.error, "Não foi possível carregar os webhooks.")}
        </p>
      )}
      {webhooks.isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}
      {webhooks.data?.length === 0 && <p className="text-sm text-muted-foreground">Ainda não há webhooks.</p>}

      <div className="space-y-3">
        {webhooks.data?.map((w) => (
          <Card key={w.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-medium">{w.name}</h2>
                    <Badge className={w.active ? "border-green-200 bg-green-100 text-green-800" : ""}>{w.active ? "Ativo" : "Desativado"}</Badge>
                    {w.consecutiveFailures > 0 && w.active && (
                      <Badge className="border-amber-200 bg-amber-100 text-amber-800">{w.consecutiveFailures} falha(s) seguida(s)</Badge>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground" title={w.url}>
                    <code>{w.url}</code>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {w.events.map((e) => (
                      <Badge key={e}>{e === "*" ? "todos os eventos" : e}</Badge>
                    ))}
                  </div>
                  {w.disabledReason && <p className="text-xs text-red-700">{w.disabledReason}. Corrige o destino e volta a ativar.</p>}
                  <p className="text-xs text-muted-foreground">
                    Último sucesso: {formatDate(w.lastSuccessAt)} · Última falha: {formatDate(w.lastFailureAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button variant="outline" size="sm" disabled={!w.active || test.isPending} onClick={() => test.mutate(w)}>
                    Enviar teste
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setExpanded(expanded === w.id ? null : w.id)}>
                    {expanded === w.id ? "Esconder entregas" : "Entregas"}
                  </Button>
                  <Button variant="outline" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(w)}>
                    {w.active ? "Desativar" : "Ativar"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirm({ kind: "rotate", webhook: w })}>
                    Novo segredo
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setConfirm({ kind: "delete", webhook: w })}>
                    Apagar
                  </Button>
                </div>
              </div>
              {expanded === w.id && <Deliveries subscriptionId={w.id} />}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo webhook</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>Nome</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: n8n — novos leads" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Endereço de destino (URL)</span>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.10:5678/webhook/..." />
          </label>
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1">Eventos</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allEvents} onChange={(e) => setAllEvents(e.target.checked)} />
              <span>Todos os eventos (incluindo os que vierem a existir)</span>
            </label>
            {!allEvents &&
              events.data
                ?.filter((e) => e.type !== "webhook.test")
                .map((e) => (
                  <label key={e.type} className="flex items-start gap-2">
                    <input type="checkbox" checked={selected.includes(e.type)} onChange={() => toggleEvent(e.type)} className="mt-1" />
                    <span>
                      <code>{e.type}</code>
                      <span className="block text-xs text-muted-foreground">{e.description}</span>
                    </span>
                  </label>
                ))}
          </fieldset>
          {create.isError && <p className="text-sm text-red-600">{errorMessage(create.error, "Não foi possível criar o webhook.")}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || !canCreate}>
              {create.isPending ? "A criar..." : "Criar webhook"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={secret !== null} onClose={() => undefined} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{secret?.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            Este é o <strong>segredo de assinatura</strong>. Guarda-o no sistema de destino para ele confirmar que os avisos vêm mesmo
            do CRM. <strong>Não volta a ser mostrado</strong>; se o perderes, gera um novo.
          </p>
          <code className="block break-all rounded-md border border-border bg-muted px-3 py-2 text-xs" data-testid="webhook-secret">
            {secret?.value}
          </code>
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={copySecret}>
              {copied ? "Copiado" : "Copiar"}
            </Button>
            <Button
              onClick={() => {
                setSecret(null);
                setCopied(false);
              }}
            >
              Já guardei o segredo
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{confirm?.kind === "delete" ? `Apagar «${confirm.webhook.name}»?` : `Gerar novo segredo para «${confirm?.webhook.name}»?`}</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          {confirm?.kind === "delete"
            ? "O destino deixa de ser avisado e o registo de entregas deste webhook é apagado. Não se pode desfazer."
            : "O segredo atual deixa de valer imediatamente: o destino rejeitará os avisos até lhe pores o novo."}
        </p>
        {(remove.isError || rotate.isError) && (
          <p className="mt-2 text-sm text-red-600">{errorMessage(remove.error ?? rotate.error, "A operação falhou.")}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Cancelar
          </Button>
          <Button
            disabled={remove.isPending || rotate.isPending}
            onClick={() => confirm && (confirm.kind === "delete" ? remove.mutate(confirm.webhook) : rotate.mutate(confirm.webhook))}
          >
            {confirm?.kind === "delete" ? "Apagar" : "Gerar novo segredo"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
