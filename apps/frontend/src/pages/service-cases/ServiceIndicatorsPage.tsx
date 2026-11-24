import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatQuantity, getServiceIndicators } from "@/lib/service-cases-api";
import { formatDuration } from "@/lib/time-entries-api";
import { errorMessage } from "@/lib/errors";
import { useModuleEnabled } from "@/lib/useModules";
import { UserPicker } from "@/components/pickers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Preset = "thisMonth" | "lastMonth" | "last30" | "thisYear" | "custom";

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "thisMonth", label: "Este mês" },
  { value: "lastMonth", label: "Mês passado" },
  { value: "last30", label: "Últimos 30 dias" },
  { value: "thisYear", label: "Este ano" },
  { value: "custom", label: "Datas à escolha" },
];

/** «AAAA-MM-DD» no fuso do browser. */
const dayInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Período [from, to) em hora local: dias inteiros, o último incluído. */
function periodOf(preset: Preset, custom: { from: string; to: string }) {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  switch (preset) {
    case "thisMonth":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
    case "lastMonth":
      return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
    case "last30": {
      const to = new Date(startOfDay(now).getTime());
      to.setDate(to.getDate() + 1);
      const from = new Date(to);
      from.setDate(from.getDate() - 30);
      return { from, to };
    }
    case "thisYear":
      return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1) };
    case "custom": {
      const from = custom.from ? new Date(`${custom.from}T00:00`) : null;
      const to = custom.to ? new Date(`${custom.to}T00:00`) : null;
      if (!from || !to) return null;
      to.setDate(to.getDate() + 1); // o último dia conta inteiro
      return to > from ? { from, to } : null;
    }
  }
}

const hours = (h: number | null) => (h === null ? "—" : h < 24 ? `${h.toLocaleString("pt-PT")} h` : `${(h / 24).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} dias`);

/** Número em destaque. */
function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Barra fina de uma só série, com o valor escrito ao lado (sem legenda; a tabela é a vista acessível). */
function Bar({ value, max, label }: { value: number; max: number; label: string }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2" title={label}>
      <div className="h-2 flex-1 rounded-r bg-muted">
        <div className="h-2 rounded-r bg-primary" style={{ width: `${width}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right tabular-nums">{label}</span>
    </div>
  );
}

/**
 * Indicadores das assistências (Fase 4c): números do período, em aberto por passo (agora), tempo por técnico e peças
 * mais usadas. O filtro de pessoa vale para o responsável das assistências e, no tempo, para quem o registou.
 */
export function ServiceIndicatorsPage() {
  const [preset, setPreset] = useState<Preset>("thisMonth");
  const [custom, setCustom] = useState(() => ({ from: dayInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: dayInput(new Date()) }));
  const [assigneeId, setAssigneeId] = useState("");
  const productsOn = useModuleEnabled("produtos");
  const period = useMemo(() => periodOf(preset, custom), [preset, custom]);
  const query = useQuery({
    queryKey: ["service-cases", "indicators", period?.from.toISOString(), period?.to.toISOString(), assigneeId],
    queryFn: () => getServiceIndicators({ from: period!.from.toISOString(), to: period!.to.toISOString(), assigneeId: assigneeId || undefined }),
    enabled: !!period,
  });
  const data = query.data;
  const maxOpen = Math.max(0, ...(data?.openByStep.map((s) => s.count) ?? []));
  const maxTime = Math.max(0, ...(data?.timeByTechnician.map((t) => t.totalSeconds) ?? []));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Link to="/assistencias" className="text-xs text-muted-foreground hover:underline">← Assistências</Link>
        <h1 className="text-2xl font-semibold">Indicadores das assistências</h1>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Período" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="w-44">
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
        {preset === "custom" && (
          <>
            <Input aria-label="De" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="w-40" />
            <span className="text-sm text-muted-foreground">a</span>
            <Input aria-label="Até" type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="w-40" />
          </>
        )}
        <UserPicker aria-label="Pessoa" value={assigneeId} onChange={(id) => setAssigneeId(id)} emptyLabel="Todas as pessoas" className="w-56" />
      </div>
      {!period && <p className="text-sm text-red-600">Escolhe um período válido (o fim não pode ser antes do início).</p>}
      {query.isError && <p className="text-sm text-red-600">{errorMessage(query.error, "Não foi possível carregar os indicadores.")}</p>}
      {query.isLoading && period && <p className="text-muted-foreground">A carregar...</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Stat label="Entradas" value={data.created} />
            <Stat label="Resolvidas" value={data.resolved} />
            <Stat label="Sem reparação" value={data.notRepaired} />
            <Stat label="Em aberto (agora)" value={data.openTotal} />
            <Stat label="Tempo médio até resolver" value={hours(data.resolution.averageHours)} hint="da entrada à conclusão" />
            <Stat label="Mediana até resolver" value={hours(data.resolution.medianHours)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Em aberto por passo</CardTitle>
              </CardHeader>
              <CardContent>
                {data.openByStep.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma assistência em aberto.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {data.openByStep.map((s) => (
                        <tr key={s.stepId ?? s.name}>
                          <td className="w-40 py-1 pr-3">{s.name}</td>
                          <td className="py-1">
                            <Bar value={s.count} max={maxOpen} label={String(s.count)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tempo por técnico</CardTitle>
              </CardHeader>
              <CardContent>
                {data.timeByTechnician.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem tempo registado em assistências no período.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="pb-1 font-medium">Técnico</th>
                        <th className="pb-1 font-medium">Total</th>
                        <th className="pb-1 text-right font-medium">Faturável</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.timeByTechnician.map((t) => (
                        <tr key={t.user.id}>
                          <td className="w-40 py-1 pr-3">{t.user.name}</td>
                          <td className="py-1">
                            <Bar value={t.totalSeconds} max={maxTime} label={formatDuration(t.totalSeconds)} />
                          </td>
                          <td className="py-1 pl-3 text-right tabular-nums text-muted-foreground">{formatDuration(t.billableSeconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Peças mais usadas</CardTitle>
            </CardHeader>
            <CardContent>
              {data.topParts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem peças registadas no período.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-1 font-medium">Peça</th>
                      <th className="pb-1 font-medium">Referência</th>
                      <th className="pb-1 text-right font-medium">Quantidade</th>
                      <th className="pb-1 text-right font-medium">Assistências</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topParts.map((p) => (
                      <tr key={p.productId ?? `${p.description}|${p.reference ?? ""}`} className="border-t border-border">
                        <td className="py-1">
                          {p.productId && productsOn ? (
                            <Link to={`/produtos/${p.productId}`} className="hover:underline">
                              {p.description}
                            </Link>
                          ) : (
                            p.description
                          )}
                        </td>
                        <td className="py-1 font-mono text-xs text-muted-foreground">{p.reference ?? "—"}</td>
                        <td className="py-1 text-right tabular-nums">{formatQuantity(p.quantity)}</td>
                        <td className="py-1 text-right tabular-nums">{p.cases}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
