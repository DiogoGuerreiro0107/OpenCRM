import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Carrier } from "@opencrm/shared-types";
import {
  createCarrier,
  deleteCarrier,
  listCarriers,
  trackingLink,
  updateCarrier,
} from "@/lib/orders-api";
import { errorMessage } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EXAMPLE_CODE = "RR123456789PT";

/** O mesmo que o servidor exige: http(s) e com `{codigo}`. Vazio = sem link. */
function templateProblem(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!v.includes("{codigo}"))
    return "O link tem de ter {codigo} no sítio do código.";
  try {
    const url = new URL(v.split("{codigo}").join("X"));
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return "O link tem de começar por http:// ou https://.";
  } catch {
    return "Link inválido.";
  }
  return null;
}

/** Uma transportadora: nome, link de seguimento, ordem, ativar/desativar e apagar (só sem expedições). */
function CarrierRow({ carrier }: { carrier: Carrier }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(carrier.name);
  const [template, setTemplate] = useState(carrier.trackingUrlTemplate ?? "");
  const [order, setOrder] = useState(String(carrier.sortOrder));
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["carriers"] });
  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateCarrier>[1]) =>
      updateCarrier(carrier.id, input),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => deleteCarrier(carrier.id),
    onSuccess: refresh,
  });
  const orderValue = Number(order);
  const problem = templateProblem(template);
  const changed =
    name.trim() !== carrier.name ||
    template.trim() !== (carrier.trackingUrlTemplate ?? "") ||
    orderValue !== carrier.sortOrder;
  const example = problem
    ? null
    : trackingLink(template.trim() || null, EXAMPLE_CODE);

  return (
    <tr className="border-t border-border align-top">
      <td className="w-48 min-w-[10rem] py-2 pr-2">
        <Input
          aria-label="Nome da transportadora"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className="h-8"
        />
      </td>
      <td className="min-w-[16rem] py-2 pr-2">
        <Input
          aria-label="Link de seguimento"
          value={template}
          maxLength={500}
          placeholder="https://…{codigo}…"
          onChange={(e) => setTemplate(e.target.value)}
          className="h-8 font-mono text-xs"
        />
        {problem ? (
          <p className="mt-0.5 text-xs text-amber-700">{problem}</p>
        ) : (
          example && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Ex.: {example}
            </p>
          )
        )}
      </td>
      <td className="w-20 py-2 pr-2">
        <Input
          aria-label="Ordem"
          inputMode="numeric"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          className="h-8 text-right"
        />
      </td>
      <td className="py-2 pr-2 text-right tabular-nums">
        {carrier.shipmentCount}
      </td>
      <td className="py-2 pr-2">
        {carrier.active ? (
          <Badge className="border-green-200 bg-green-100 text-green-800">
            Ativa
          </Badge>
        ) : (
          <Badge>Desativada</Badge>
        )}
      </td>
      <td className="py-2 text-right">
        <div className="flex justify-end gap-1">
          {changed && (
            <Button
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={
                save.isPending ||
                !name.trim() ||
                !!problem ||
                !Number.isInteger(orderValue) ||
                orderValue < 0
              }
              onClick={() =>
                save.mutate({
                  name: name.trim(),
                  trackingUrlTemplate: template.trim() || null,
                  sortOrder: orderValue,
                })
              }
            >
              Guardar
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            disabled={save.isPending}
            onClick={() => save.mutate({ active: !carrier.active })}
          >
            {carrier.active ? "Desativar" : "Ativar"}
          </Button>
          {carrier.shipmentCount === 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2 text-xs text-red-700"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Apagar
            </Button>
          )}
        </div>
        {(save.isError || remove.isError) && (
          <p className="text-xs text-red-600">
            {errorMessage(save.error ?? remove.error, "Não foi possível.")}
          </p>
        )}
      </td>
    </tr>
  );
}

/**
 * Configurações > Transportadoras (Fase 6d, área «Encomendas»). O link de seguimento leva `{codigo}` no sítio do
 * código; com expedições, desativa-se em vez de apagar.
 */
export function CarriersSettingsPage() {
  const queryClient = useQueryClient();
  const { data: carriers = [], isLoading } = useQuery({
    queryKey: ["carriers"],
    queryFn: listCarriers,
  });
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const problem = templateProblem(template);
  const add = useMutation({
    mutationFn: () =>
      createCarrier({
        name: name.trim(),
        trackingUrlTemplate: template.trim() || null,
        sortOrder: carriers.length
          ? Math.max(...carriers.map((c) => c.sortOrder)) + 1
          : 0,
      }),
    onSuccess: () => {
      setName("");
      setTemplate("");
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
    },
  });

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Transportadoras</h1>
        <p className="text-sm text-muted-foreground">
          Escolhem-se ao marcar uma encomenda como enviada. O link de seguimento
          é o da página da transportadora com{" "}
          <code className="font-mono">{"{codigo}"}</code> no sítio do código
          (ex.:{" "}
          <code className="font-mono">
            {"https://transportadora.pt/seguir?codigo={codigo}"}
          </code>
          ). Com expedições, desativa-se em vez de apagar.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-background p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">A carregar...</p>
        ) : carriers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ainda não há transportadoras.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 font-medium">Nome</th>
                  <th className="pb-1 font-medium">Link de seguimento</th>
                  <th className="pb-1 font-medium">Ordem</th>
                  <th className="pb-1 pr-2 text-right font-medium">
                    Expedições
                  </th>
                  <th className="pb-1 font-medium">Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {carriers.map((c) => (
                  <CarrierRow
                    key={`${c.id}-${c.name}-${c.trackingUrlTemplate}-${c.sortOrder}`}
                    carrier={c}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form
          className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && !problem) add.mutate();
          }}
        >
          <Input
            aria-label="Nova transportadora"
            placeholder="Nova transportadora"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            className="max-w-xs"
          />
          <Input
            aria-label="Link de seguimento da nova transportadora"
            placeholder="Link de seguimento (opcional)"
            value={template}
            maxLength={500}
            onChange={(e) => setTemplate(e.target.value)}
            className="min-w-64 flex-1 font-mono text-xs"
          />
          <Button
            type="submit"
            disabled={add.isPending || !name.trim() || !!problem}
          >
            Adicionar
          </Button>
        </form>
        {problem && <p className="mt-1 text-xs text-amber-700">{problem}</p>}
        {add.isError && (
          <p className="mt-1 text-xs text-red-600">
            {errorMessage(
              add.error,
              "Não foi possível criar a transportadora.",
            )}
          </p>
        )}
      </div>
    </div>
  );
}
