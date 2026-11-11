import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiKeyView, CreatedApiKey } from "@opencrm/shared-types";
import { createApiKey, listApiKeys, listApiScopes, revokeApiKey } from "@/lib/api-keys-api";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-PT") : "—");

const STATUS_LABEL: Record<ApiKeyView["status"], string> = { active: "Ativa", expired: "Expirada", revoked: "Revogada" };
const STATUS_CLASS: Record<ApiKeyView["status"], string> = {
  active: "border-green-200 bg-green-100 text-green-800",
  expired: "border-amber-200 bg-amber-100 text-amber-800",
  revoked: "",
};

export function ApiKeysPage() {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: listApiKeys });
  const scopes = useQuery({ queryKey: ["api-keys", "scopes"], queryFn: listApiScopes });

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [expires, setExpires] = useState("");
  const [rate, setRate] = useState("120");
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [toRevoke, setToRevoke] = useState<ApiKeyView | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createApiKey({
        name: name.trim(),
        scopes: selected,
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : undefined,
        rateLimitPerMinute: Number(rate) || undefined,
      }),
    onSuccess: (key) => {
      setCreated(key);
      setIsCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      setToRevoke(null);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  function openCreate() {
    setName("");
    setSelected([]);
    setExpires("");
    setRate("120");
    create.reset();
    setIsCreateOpen(true);
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.key);
      setCopied(true);
    } catch {
      setCopied(false); // sem permissão para a área de transferência: o utilizador copia à mão
    }
  }

  const toggleScope = (scope: string) =>
    setSelected((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Chaves de API</h1>
          <p className="text-sm text-muted-foreground">
            Credenciais para sistemas externos (loja online, formulários, n8n...) falarem com o CRM pela API pública{" "}
            <code>/api/v1</code>. Cada chave só pode fazer o que lhe deres (âmbitos) e revoga-se a qualquer momento. A
            chave completa só se vê <strong>uma vez</strong>, ao criar.
          </p>
        </div>
        <Button onClick={openCreate}>Nova chave</Button>
      </div>

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Atenção: se o CRM for usado por <code>http://</code> (sem HTTPS), a chave viaja sem cifra e quem estiver na rede
        pode lê-la. Usa estas chaves só em redes de confiança até haver HTTPS.
      </p>

      {keys.isError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage(keys.error, "Não foi possível carregar as chaves.")}
        </p>
      )}
      {keys.isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}
      {keys.data?.length === 0 && <p className="text-sm text-muted-foreground">Ainda não há chaves.</p>}

      <div className="space-y-3">
        {keys.data?.map((k) => (
          <Card key={k.id}>
            <CardContent className="flex items-start justify-between gap-4 p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium">{k.name}</h2>
                  <Badge className={STATUS_CLASS[k.status]}>{STATUS_LABEL[k.status]}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  <code>{k.prefix}…</code> · {k.rateLimitPerMinute} pedidos/min
                </p>
                <div className="flex flex-wrap gap-1">
                  {k.scopes.map((s) => (
                    <Badge key={s}>{s}</Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Criada em {formatDate(k.createdAt)} · Última utilização: {formatDate(k.lastUsedAt)} · Expira:{" "}
                  {k.expiresAt ? formatDate(k.expiresAt) : "nunca"}
                  {k.revokedAt ? ` · Revogada em ${formatDate(k.revokedAt)}` : ""}
                </p>
              </div>
              {k.status !== "revoked" && (
                <Button variant="outline" size="sm" onClick={() => setToRevoke(k)}>
                  Revogar
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova chave de API</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>Nome (para saberes de onde vem)</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Ex.: Formulário do site" />
          </label>
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1">Permissões (âmbitos)</legend>
            {scopes.data?.map((s) => (
              <label key={s.scope} className="flex items-start gap-2">
                <input type="checkbox" checked={selected.includes(s.scope)} onChange={() => toggleScope(s.scope)} className="mt-1" />
                <span>
                  <code>{s.scope}</code>
                  <span className="block text-xs text-muted-foreground">{s.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-sm">
              <span>Expira em (opcional)</span>
              <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </label>
            <label className="block space-y-1 text-sm">
              <span>Pedidos por minuto</span>
              <Input type="number" min={1} max={1000} value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
          </div>
          {create.isError && <p className="text-sm text-red-600">{errorMessage(create.error, "Não foi possível criar a chave.")}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.isPending || name.trim() === "" || selected.length === 0}>
              {create.isPending ? "A criar..." : "Criar chave"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={created !== null} onClose={() => undefined} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Chave criada</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>
            Copia a chave <strong>agora</strong>: depois de fechares esta janela <strong>não volta a ser mostrada</strong> (só o
            prefixo). Se a perderes, revoga-a e cria outra.
          </p>
          <code className="block break-all rounded-md border border-border bg-muted px-3 py-2 text-xs" data-testid="new-api-key">
            {created?.key}
          </code>
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={copyKey}>
              {copied ? "Copiada" : "Copiar"}
            </Button>
            <Button
              onClick={() => {
                setCreated(null);
                setCopied(false);
              }}
            >
              Já guardei a chave
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={toRevoke !== null} onClose={() => setToRevoke(null)} className="max-w-md">
        <DialogHeader>
          <DialogTitle>Revogar «{toRevoke?.name}»?</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          Qualquer sistema que use esta chave deixa de funcionar <strong>imediatamente</strong>. Não se pode desfazer.
        </p>
        {revoke.isError && <p className="mt-2 text-sm text-red-600">{errorMessage(revoke.error, "Não foi possível revogar.")}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setToRevoke(null)}>
            Cancelar
          </Button>
          <Button onClick={() => toRevoke && revoke.mutate(toRevoke.id)} disabled={revoke.isPending}>
            {revoke.isPending ? "A revogar..." : "Revogar"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
