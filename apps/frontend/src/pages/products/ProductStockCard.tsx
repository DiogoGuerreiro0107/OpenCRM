import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Product } from "@opencrm/shared-types";
import { createStockMovement, formatQty, listStockMovements, type ManualMovementType, MOVEMENT_LABELS } from "@/lib/stock-api";
import { parseDecimal } from "@/lib/products-api";
import { LoadMore, usePagedList } from "@/lib/pagination";
import { errorMessage } from "@/lib/errors";
import { useCanWrite } from "@/lib/useCanWrite";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const dateTime = (iso: string) => new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });

/** Lançar um movimento: entradas, saídas, devoluções e inicial pedem a quantidade; o acerto pede a contagem e o motivo. */
function MovementDialog({ product, type, onClose }: { product: Product; type: ManualMovementType; onClose: () => void }) {
  const queryClient = useQueryClient();
  const counting = type === "ADJUSTMENT";
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const value = parseDecimal(qty);
  const validQty = value !== null && !Number.isNaN(value) && (counting ? value >= 0 : value > 0);
  const save = useMutation({
    mutationFn: () =>
      createStockMovement({
        productId: product.id,
        type,
        ...(counting ? { countedQuantity: value! } : { quantity: value! }),
        reason: reason.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{MOVEMENT_LABELS[type]}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (validQty && (!counting || reason.trim())) save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          {product.sku} · {product.name} · stock atual {formatQty(product.stockOnHand)}
        </p>
        <div className="space-y-1">
          <Label htmlFor="mv-qty">{counting ? "Quantidade contada *" : "Quantidade *"}</Label>
          <Input id="mv-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus required />
          {counting && validQty && <p className="text-xs text-muted-foreground">Diferença: {formatQty(Math.round((value! - product.stockOnHand) * 100) / 100, true)}</p>}
        </div>
        {counting && (
          <div className="space-y-1">
            <Label htmlFor="mv-reason">Motivo *</Label>
            <Input id="mv-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: inventário de novembro" required />
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="mv-note">Nota</Label>
          <Input id="mv-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={type === "PURCHASE_IN" ? "Ex.: fatura do fornecedor" : ""} />
        </div>
        {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível lançar o movimento.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending || !validQty || (counting && !reason.trim())}>
            {save.isPending ? "A lançar..." : "Lançar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Stock de um produto (Fase 5b): atual (com o mínimo e os avisos), botões para lançar movimentos (área «Movimentos de
 * stock») e histórico. Os movimentos não se alteram: corrige-se com outro.
 */
export function ProductStockCard({ product }: { product: Product }) {
  const canMove = useCanWrite("stock");
  const [dialog, setDialog] = useState<ManualMovementType | null>(null);
  const history = usePagedList(["stock", "movements", product.id], (cursor) => listStockMovements({ productId: product.id, cursor, limit: 10 }));
  const negative = product.stockOnHand < 0;
  const types: ManualMovementType[] = history.items.length === 0 && !history.isLoading ? ["INITIAL", "PURCHASE_IN", "SALE_OUT"] : ["PURCHASE_IN", "SALE_OUT", "RETURN", "ADJUSTMENT"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={cn("text-3xl font-semibold tabular-nums", negative && "text-red-700")}>{formatQty(product.stockOnHand)}</span>
          {product.minStock !== null && <span className="text-sm text-muted-foreground">mínimo {formatQty(product.minStock)}</span>}
          {negative && <Badge className="border-red-200 bg-red-100 text-red-800">Negativo</Badge>}
          {!negative && product.belowMin && <Badge className="border-amber-200 bg-amber-100 text-amber-900">Abaixo do mínimo</Badge>}
        </div>
        {canMove && (
          <div className="flex flex-wrap gap-2">
            {types.map((t) => (
              <Button key={t} size="sm" variant={t === "PURCHASE_IN" ? "default" : "outline"} onClick={() => setDialog(t)}>
                {t === "ADJUSTMENT" ? "Acertar contagem" : MOVEMENT_LABELS[t]}
              </Button>
            ))}
          </div>
        )}
        <ul className="divide-y divide-border text-sm">
          {history.items.map((m) => (
            <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
              <span className={cn("w-16 shrink-0 text-right font-mono tabular-nums", m.quantity < 0 ? "text-red-700" : "text-green-700")}>{formatQty(m.quantity, true)}</span>
              <span className="font-medium">{MOVEMENT_LABELS[m.type]}</span>
              <span className="text-xs text-muted-foreground">
                {dateTime(m.createdAt)} · {m.user.name}
              </span>
              {(m.reason || m.note) && <span className="block w-full pl-[4.5rem] text-xs text-muted-foreground">{[m.reason, m.note].filter(Boolean).join(" — ")}</span>}
            </li>
          ))}
        </ul>
        {!history.isLoading && history.items.length === 0 && <p className="text-sm text-muted-foreground">Sem movimentos. Comece pelo stock inicial.</p>}
        <LoadMore shown={history.items.length} hasMore={history.hasNextPage} loading={history.isFetchingNextPage} onMore={() => history.fetchNextPage()} noun={["movimento", "movimentos"]} />
        {dialog && <MovementDialog product={product} type={dialog} onClose={() => setDialog(null)} />}
      </CardContent>
    </Card>
  );
}
