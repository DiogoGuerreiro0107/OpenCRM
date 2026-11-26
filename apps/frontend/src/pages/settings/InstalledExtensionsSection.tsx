import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveExtension,
  disableExtension,
  enableExtension,
  listInstalledExtensions,
  rescanExtensions,
  type InstalledExtensionView,
  type InstalledStatus,
} from "@/lib/extensions-api";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const STATUS: Record<InstalledStatus, { label: string; className: string }> = {
  pending: { label: "Por aprovar", className: "border-amber-300 bg-amber-100 text-amber-900" },
  changed: { label: "Alterada — aprovar de novo", className: "border-amber-300 bg-amber-100 text-amber-900" },
  enabled: { label: "Ligada", className: "border-green-200 bg-green-100 text-green-800" },
  disabled: { label: "Desligada", className: "" },
  disabled_auto: { label: "Desligada automaticamente", className: "border-red-200 bg-red-100 text-red-800" },
  missing: { label: "Pasta em falta", className: "" },
};

const short = (checksum: string) => `${checksum.slice(0, 12)}…${checksum.slice(-4)}`;

function InstalledCard({ ext }: { ext: InstalledExtensionView }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["modules"] });
  const approve = useMutation({ mutationFn: () => approveExtension(ext.id, ext.checksum), onSuccess: () => (setConfirming(false), refresh()) });
  const enable = useMutation({ mutationFn: () => enableExtension(ext.id), onSuccess: refresh });
  const disable = useMutation({ mutationFn: () => disableExtension(ext.id), onSuccess: refresh });
  const error = approve.error ?? enable.error ?? disable.error;
  const needsApproval = ext.status === "pending" || ext.status === "changed";
  const canEnable = ext.status === "disabled" || ext.status === "disabled_auto";

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{ext.name}</h3>
          <Badge className={STATUS[ext.status].className}>{STATUS[ext.status].label}</Badge>
          <span className="text-xs text-muted-foreground">
            {ext.id} · versão {ext.version}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{ext.description}</p>
        <div className="text-xs text-muted-foreground">
          Impressão digital: <code className="font-mono">{short(ext.checksum)}</code>
          {ext.approvedBy && ext.approvedChecksum === ext.checksum && <> · aprovada por {ext.approvedBy.name}</>}
          {ext.server ? <> · código: <code className="font-mono">{ext.server}</code></> : " · sem código (só definições)"}
          {ext.subscriptions.length > 0 && <> · recebe: {ext.subscriptions.join(", ")}</>}
        </div>
        {ext.permissions.length > 0 && (
          <ul className="list-disc pl-5 text-xs text-muted-foreground">
            {ext.permissions.map((p) => (
              <li key={p.permission}>
                {p.description} <code className="font-mono text-[11px]">{p.permission}</code>
              </li>
            ))}
          </ul>
        )}
        {ext.disabledReason && ext.status !== "enabled" && <p className="text-xs text-red-700">{ext.disabledReason}</p>}
        {ext.lastError && ext.status !== "disabled_auto" && <p className="text-xs text-red-700">Último erro: {ext.lastError}</p>}
        {confirming && (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              <strong>O código desta extensão vai correr dentro do CRM, com acesso a tudo</strong> (dados, segredos e rede). As
              permissões acima são o que ela declara, não uma barreira. Aprova só código escrito ou revisto pela tua equipa.
            </p>
            <p className="text-xs">
              Vais aprovar exatamente estes ficheiros: <code className="break-all font-mono">{ext.checksum}</code>. Se mudarem,
              a extensão deixa de carregar até aprovares de novo.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate()}>
                Aprovar estes ficheiros
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {needsApproval && !confirming && (
            <Button size="sm" onClick={() => setConfirming(true)}>
              Aprovar…
            </Button>
          )}
          {canEnable && (
            <Button size="sm" disabled={enable.isPending} onClick={() => enable.mutate()}>
              Ligar
            </Button>
          )}
          {ext.status === "enabled" && (
            <Button size="sm" variant="outline" disabled={disable.isPending} onClick={() => disable.mutate()}>
              Desligar
            </Button>
          )}
          {ext.hasSettings && ext.status !== "missing" && (
            <Link to={`/configuracoes/extensoes/${ext.id}`} className="text-xs font-medium text-primary hover:underline">
              Definições
            </Link>
          )}
        </div>
        {error && <p className="text-xs text-red-600">{errorMessage(error, "Não foi possível.")}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Extensões instaladas da pasta do servidor (Fase E1.4): código da equipa que corre dentro do CRM. Só carregam com a
 * impressão digital aprovada por um Administrador.
 */
export function InstalledExtensionsSection() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["modules", "installed"], queryFn: listInstalledExtensions });
  const rescan = useMutation({ mutationFn: rescanExtensions, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["modules"] }) });

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Extensões instaladas</h2>
          <p className="text-sm text-muted-foreground">
            Extensões que a tua equipa pôs na pasta do servidor
            {data && (
              <>
                {" "}
                (<code className="font-mono text-xs">{data.directory}</code>)
              </>
            )}
            . Correm dentro do CRM com acesso total: só carregam depois de um Administrador aprovar os ficheiros.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={rescan.isPending} onClick={() => rescan.mutate()}>
          {rescan.isPending ? "A procurar..." : "Procurar de novo"}
        </Button>
      </div>
      {rescan.isError && <p className="text-sm text-red-600">{errorMessage(rescan.error, "Não foi possível procurar.")}</p>}
      {isLoading && <p className="text-sm text-muted-foreground">A carregar...</p>}
      {data && data.extensions.length === 0 && data.problems.length === 0 && <p className="text-sm text-muted-foreground">Não há extensões na pasta.</p>}
      {data?.problems.map((p) => (
        <p key={p.folder} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Pasta <code className="font-mono">{p.folder}</code> ignorada: {p.errors.join("; ")}
        </p>
      ))}
      <div className="space-y-3">
        {data?.extensions.map((ext) => (
          <InstalledCard key={ext.id} ext={ext} />
        ))}
      </div>
    </section>
  );
}
