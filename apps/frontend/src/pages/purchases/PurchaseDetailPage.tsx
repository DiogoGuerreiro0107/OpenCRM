import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Product, PurchaseOrder, PurchaseOrderLine } from "@opencrm/shared-types";
import {
  addPurchaseLine,
  cancelPurchase,
  closePurchase,
  deletePurchase,
  deletePurchaseLine,
  formatDay,
  getPurchase,
  receivePurchase,
  sendPurchase,
  updatePurchase,
  updatePurchaseLine,
} from "@/lib/purchases-api";
import { decimalInput, formatMoney, parseDecimal } from "@/lib/products-api";
import { errorMessage } from "@/lib/errors";
import { useCanWrite } from "@/lib/useCanWrite";
import { CompanyPicker, ProductPicker } from "@/components/pickers";
import { TimelineSection } from "@/components/TimelineSection";
import { ReadOnlyFieldset } from "@/components/ReadOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PurchaseStatusBadge } from "./PurchasesListPage";

const qty = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 2 });
/** Custo com 2 casas, ou 4 quando as tem (como no catálogo). */
const cost = (n: number | undefined) => (n === undefined ? "—" : formatMoney(n, Math.round(n * 100) / 100 === n ? 2 : 4));
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : null);
const open = (p: PurchaseOrder) => p.status === "DRAFT" || p.status === "SENT";

// ---- Cabeçalho ----

interface HeaderForm {
  supplierId: string;
  supplierReference: string;
  expectedAt: string;
  notes: string;
}

const headerOf = (p: PurchaseOrder): HeaderForm => ({ supplierId: p.supplierId, supplierReference: p.supplierReference ?? "", expectedAt: p.expectedAt ?? "", notes: p.notes ?? "" });

function HeaderCard({ purchase, canEdit, onSaved }: { purchase: PurchaseOrder; canEdit: boolean; onSaved: (p: PurchaseOrder) => void }) {
  const [form, setForm] = useState(() => headerOf(purchase));
  const [loadedId, setLoadedId] = useState(purchase.id);
  // O formulário copia a compra só ao abrir (ou ao gravar): o tempo real não apaga o que se está a escrever.
  useEffect(() => {
    if (purchase.id === loadedId) return;
    setForm(headerOf(purchase));
    setLoadedId(purchase.id);
  }, [purchase, loadedId]);
  const draft = purchase.status === "DRAFT";
  const editable = canEdit && open(purchase);
  const save = useMutation({
    mutationFn: () =>
      updatePurchase(purchase.id, {
        ...(draft ? { supplierId: form.supplierId } : {}),
        supplierReference: form.supplierReference.trim() || null,
        expectedAt: form.expectedAt || null,
        notes: form.notes.trim() || null,
      }),
    onSuccess: (p) => {
      setForm(headerOf(p));
      onSaved(p);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da compra</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <ReadOnlyFieldset disabled={!editable}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="p-supplier">Fornecedor</Label>
                <CompanyPicker id="p-supplier" suppliersOnly value={form.supplierId} selectedLabel={purchase.supplier.name} disabled={!draft} onChange={(id) => id && setForm({ ...form, supplierId: id })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p-ref">Referência do fornecedor</Label>
                <Input id="p-ref" value={form.supplierReference} maxLength={100} onChange={(e) => setForm({ ...form, supplierReference: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p-expected">Entrega prevista</Label>
                <Input id="p-expected" type="date" value={form.expectedAt} onChange={(e) => setForm({ ...form, expectedAt: e.target.value })} className="w-44" />
              </div>
            </div>
            <div className="mt-3 space-y-1">
              <Label htmlFor="p-notes">Observações</Label>
              <Textarea id="p-notes" rows={3} maxLength={5000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </ReadOnlyFieldset>
          {!draft && editable && <p className="text-xs text-muted-foreground">O fornecedor só se muda enquanto a compra é rascunho.</p>}
          {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível guardar.")}</p>}
          {save.isSuccess && !save.isPending && <p className="text-sm text-green-700">Guardado.</p>}
          {editable && (
            <div className="flex justify-end">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "A guardar..." : "Guardar"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

// ---- Linhas ----

function parseQty(value: string) {
  const n = parseDecimal(value);
  return n === null || Number.isNaN(n) || n <= 0 ? null : n;
}

/** Linha nova (produto do catálogo) ou editar a quantidade/o custo. Sem a área do catálogo, o custo não aparece. */
function LineEditor({
  line,
  seesCosts,
  saving,
  error,
  onSave,
  onCancel,
}: {
  line?: PurchaseOrderLine;
  seesCosts: boolean;
  saving: boolean;
  error: unknown;
  onSave: (input: { productId?: string; quantity: number; unitCost?: number }) => void;
  onCancel?: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(line ? decimalInput(line.quantity) : "1");
  const [unitCost, setUnitCost] = useState(line?.unitCost !== undefined ? decimalInput(line.unitCost) : "");
  const [localError, setLocalError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const q = parseQty(quantity);
        const c = unitCost.trim() ? parseDecimal(unitCost) : undefined;
        if (!line && !productId) return setLocalError("Escolhe o produto.");
        if (q === null) return setLocalError("A quantidade tem de ser positiva.");
        if (c !== undefined && (c === null || Number.isNaN(c) || c < 0)) return setLocalError("O custo não pode ser negativo.");
        setLocalError(null);
        // Sem mexer no custo, fica o do catálogo (linha nova) ou o que tinha (editar).
        const costChanged = c !== undefined && (line ? c !== line.unitCost : true);
        onSave({ ...(line ? {} : { productId }), quantity: q, ...(seesCosts && costChanged ? { unitCost: c } : {}) });
      }}
    >
      {!line && (
        <ProductPicker
          aria-label="Produto do catálogo"
          value={productId}
          showStock
          onChange={(id, item) => {
            setProductId(id);
            setProduct(item);
          }}
          selectedLabel={product?.name}
          emptyLabel="Produto..."
          className="w-80"
        />
      )}
      <Input aria-label="Quantidade" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-24" />
      {seesCosts && <Input aria-label="Custo unitário sem IVA" placeholder={line ? "Custo" : "Custo do catálogo"} inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className="w-36" />}
      <Button type="submit" size="sm" disabled={saving}>
        {line ? "Guardar" : "Acrescentar"}
      </Button>
      {onCancel && (
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      )}
      {(localError || !!error) && <p className="w-full text-xs text-red-600">{localError ?? errorMessage(error, "Não foi possível guardar a linha.")}</p>}
    </form>
  );
}

function LinesCard({ purchase, canEdit, seesCosts, onChanged }: { purchase: PurchaseOrder; canEdit: boolean; seesCosts: boolean; onChanged: (p: PurchaseOrder) => void }) {
  const editable = canEdit && purchase.status === "DRAFT";
  const showReceived = purchase.status !== "DRAFT";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addKey, setAddKey] = useState(0);
  const add = useMutation({
    mutationFn: (input: { productId?: string; quantity: number; unitCost?: number }) => addPurchaseLine(purchase.id, { productId: input.productId!, quantity: input.quantity, unitCost: input.unitCost }),
    onSuccess: (p) => {
      setAddKey((k) => k + 1);
      onChanged(p);
    },
  });
  const save = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { quantity: number; unitCost?: number } }) => updatePurchaseLine(purchase.id, id, input),
    onSuccess: (p) => {
      setEditingId(null);
      onChanged(p);
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => deletePurchaseLine(purchase.id, id), onSuccess: onChanged });
  const cols = 2 + (showReceived ? 1 : 0) + (seesCosts ? 2 : 0) + (editable ? 1 : 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linhas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-1 font-medium">Produto</th>
                <th className="pb-1 text-right font-medium">Qtd.</th>
                {showReceived && <th className="pb-1 text-right font-medium">Recebido</th>}
                {seesCosts && <th className="pb-1 text-right font-medium">Custo</th>}
                {seesCosts && <th className="pb-1 text-right font-medium">Total s/ IVA</th>}
                {editable && <th className="pb-1" />}
              </tr>
            </thead>
            <tbody>
              {purchase.lines.length === 0 && (
                <tr>
                  <td colSpan={cols} className="py-3 text-muted-foreground">
                    Sem linhas.
                  </td>
                </tr>
              )}
              {purchase.lines.map((l) =>
                editingId === l.id ? (
                  <tr key={l.id} className="border-t border-border">
                    <td colSpan={cols} className="py-2">
                      <p className="mb-1 text-xs text-muted-foreground">
                        {l.description} <span className="font-mono">{l.sku}</span>
                      </p>
                      <LineEditor line={l} seesCosts={seesCosts} saving={save.isPending} error={save.error} onSave={(input) => save.mutate({ id: l.id, input })} onCancel={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2">
                      {l.description}
                      <Link to={`/produtos/${l.productId}`} className="ml-2 font-mono text-xs text-muted-foreground hover:underline">
                        {l.sku}
                      </Link>
                      {l.supplierSku && <div className="text-xs text-muted-foreground">Ref. do fornecedor: {l.supplierSku}</div>}
                      {!l.product.tracksStock && <div className="text-xs text-muted-foreground">Não controla stock: receber não dá entrada</div>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{qty(l.quantity)}</td>
                    {showReceived && (
                      <td className={`py-1.5 text-right tabular-nums ${l.remainingQuantity > 0 ? "text-amber-700" : "text-green-700"}`}>
                        {qty(l.receivedQuantity)}
                        {l.remainingQuantity > 0 && purchase.status === "SENT" && <div className="text-xs">falta {qty(l.remainingQuantity)}</div>}
                      </td>
                    )}
                    {seesCosts && <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{cost(l.unitCost)}</td>}
                    {seesCosts && <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{formatMoney(l.lineTotal)}</td>}
                    {editable && (
                      <td className="whitespace-nowrap py-1 pl-2 text-right">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditingId(l.id)}>
                          Editar
                        </Button>
                        <Button size="sm" variant="outline" className="ml-1 h-7 px-2 text-xs text-red-700" disabled={remove.isPending} onClick={() => remove.mutate(l.id)}>
                          Retirar
                        </Button>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
            {seesCosts && (
              <tfoot className="border-t border-border">
                <tr>
                  <td colSpan={cols - 1 - (editable ? 1 : 0)} className="pt-2 text-right font-medium">
                    Total sem IVA
                  </td>
                  <td className="whitespace-nowrap pt-2 text-right font-semibold tabular-nums">{formatMoney(purchase.total)}</td>
                  {editable && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {remove.isError && <p className="text-xs text-red-600">{errorMessage(remove.error, "Não foi possível retirar.")}</p>}
        {editable && (
          <div className="rounded-md border border-dashed border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Acrescentar produto</p>
            <LineEditor key={addKey} seesCosts={seesCosts} saving={add.isPending} error={add.error} onSave={(input) => add.mutate(input)} />
            {seesCosts && <p className="mt-1 text-xs text-muted-foreground">Sem custo, fica o deste fornecedor no catálogo.</p>}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Valores indicativos (custo sem IVA): a fatura do fornecedor é tratada no programa de faturação.</p>
      </CardContent>
    </Card>
  );
}

// ---- Receção ----

/** Registar uma receção: por omissão, tudo o que falta (editável por linha); a nota vai para a timeline e para o stock. */
function ReceiveDialog({ purchase, onClose, onDone }: { purchase: PurchaseOrder; onClose: () => void; onDone: (p: PurchaseOrder) => void }) {
  const pending = purchase.lines.filter((l) => l.remainingQuantity > 0);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(pending.map((l) => [l.id, decimalInput(l.remainingQuantity)])));
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const receive = useMutation({ mutationFn: (lines: Array<{ lineId: string; quantity: number }>) => receivePurchase(purchase.id, { lines, note: note.trim() || undefined }), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Receção de {purchase.code}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const lines: Array<{ lineId: string; quantity: number }> = [];
          for (const l of pending) {
            const raw = (values[l.id] ?? "").trim();
            if (!raw || raw === "0") continue;
            const q = parseQty(raw);
            if (q === null) return setLocalError(`${l.description}: quantidade inválida.`);
            if (q > l.remainingQuantity) return setLocalError(`${l.description}: só falta ${qty(l.remainingQuantity)}.`);
            lines.push({ lineId: l.id, quantity: q });
          }
          if (lines.length === 0) return setLocalError("Indica o que foi recebido.");
          setLocalError(null);
          receive.mutate(lines);
        }}
      >
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="pb-1 font-medium">Produto</th>
              <th className="pb-1 text-right font-medium">Falta</th>
              <th className="pb-1 text-right font-medium">Recebido agora</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((l) => (
              <tr key={l.id} className="border-t border-border">
                <td className="py-1.5 pr-2">
                  {l.description} <span className="font-mono text-xs text-muted-foreground">{l.sku}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{qty(l.remainingQuantity)}</td>
                <td className="py-1.5 text-right">
                  <Input aria-label={`Recebido agora: ${l.description}`} inputMode="decimal" value={values[l.id] ?? ""} onChange={(e) => setValues({ ...values, [l.id]: e.target.value })} className="ml-auto w-24 text-right" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-1">
          <Label htmlFor="receive-note">Nota</Label>
          <Input id="receive-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: guia do fornecedor GR-123" />
        </div>
        <p className="text-xs text-muted-foreground">Dá entrada no stock e reserva para as encomendas à espera, das confirmadas há mais tempo para as mais recentes. Deixa a 0 o que não veio.</p>
        {(localError || receive.isError) && <p className="text-sm text-red-600">{localError ?? errorMessage(receive.error, "Não foi possível registar a receção.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" disabled={receive.isPending}>
            {receive.isPending ? "A registar..." : "Registar receção"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Fechar com falta ou cancelar: pedem o motivo. */
function ReasonDialog({ purchase, kind, onClose, onDone }: { purchase: PurchaseOrder; kind: "close" | "cancel"; onClose: () => void; onDone: (p: PurchaseOrder) => void }) {
  const [reason, setReason] = useState("");
  const run = useMutation({ mutationFn: () => (kind === "close" ? closePurchase(purchase.id, reason.trim()) : cancelPurchase(purchase.id, reason.trim())), onSuccess: onDone });
  const closing = kind === "close";
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {closing ? "Fechar com falta" : "Cancelar"} {purchase.code}
        </DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) run.mutate();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="reason">Motivo *</Label>
          <Input id="reason" value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} placeholder={closing ? "Ex.: o fornecedor já não tem" : "Ex.: encomendado por engano"} />
        </div>
        <p className="text-xs text-muted-foreground">{closing ? "O que falta receber deixa de contar como «em compra». Não volta atrás." : "Uma compra cancelada não volta atrás."}</p>
        {run.isError && <p className="text-sm text-red-600">{errorMessage(run.error, "Não foi possível concluir.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" className="bg-red-700 hover:bg-red-800" disabled={run.isPending || !reason.trim()}>
            {closing ? "Fechar com falta" : "Cancelar compra"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReceiptsCard({ purchase }: { purchase: PurchaseOrder }) {
  if (purchase.receipts.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entradas de stock</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border text-sm">
          {purchase.receipts.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 py-1.5">
              <span className="w-14 shrink-0 text-right font-mono tabular-nums text-green-700">+{qty(r.quantity)}</span>
              <Link to={`/produtos/${r.product.id}`} className="hover:underline">
                {r.product.name}
              </Link>
              <span className="font-mono text-xs text-muted-foreground">{r.product.sku}</span>
              <span className="text-xs text-muted-foreground">
                {when(r.createdAt)} · {r.user.name}
                {r.note && ` — ${r.note}`}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Ficha da compra (Fase 6c): linhas (editáveis em rascunho), enviar, receções (também em parte), fechar com falta,
 * cancelar, as entradas de stock e a timeline. Os custos só para quem tem a área «Catálogo de produtos».
 */
export function PurchaseDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useCanWrite("purchases");
  const seesCosts = useCanWrite("catalog");
  const { data: purchase, isLoading, isError } = useQuery({ queryKey: ["purchase-orders", "one", id], queryFn: () => getPurchase(id) });
  const [dialog, setDialog] = useState<"receive" | "close" | "cancel" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const changed = (p: PurchaseOrder) => {
    queryClient.setQueryData(["purchase-orders", "one", id], p);
    queryClient.invalidateQueries({ queryKey: ["purchase-orders", "list"] });
    queryClient.invalidateQueries({ queryKey: ["purchase-suggestions"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
  };
  const done = (p: PurchaseOrder) => {
    setDialog(null);
    changed(p);
  };
  const send = useMutation({ mutationFn: () => sendPurchase(id), onSuccess: changed });
  const remove = useMutation({
    mutationFn: () => deletePurchase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate("/compras");
    },
  });

  if (isLoading) return <p className="text-muted-foreground">A carregar...</p>;
  if (isError || !purchase) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground">Compra não encontrada.</p>
        <Link to="/compras" className="text-sm text-primary hover:underline">
          Voltar às compras
        </Link>
      </div>
    );
  }
  const anyReceived = purchase.lines.some((l) => l.receivedQuantity > 0);
  const dates = [
    ["Criada", when(purchase.createdAt)],
    ["Enviada", when(purchase.sentAt)],
    ["Recebida", when(purchase.receivedAt)],
    ["Fechada", when(purchase.closedAt)],
    ["Cancelada", when(purchase.cancelledAt)],
  ].filter(([, v]) => v) as Array<[string, string]>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <Link to="/compras" className="text-xs text-muted-foreground hover:underline">
            ← Compras
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            <span className="font-mono text-base text-muted-foreground">{purchase.code}</span>
            <Link to={`/empresas/${purchase.supplier.id}`} className="hover:underline">
              {purchase.supplier.name}
            </Link>
            <PurchaseStatusBadge purchase={purchase} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {dates.map(([label, value]) => `${label} ${value}`).join(" · ")}
            {purchase.createdBy && ` · por ${purchase.createdBy.name}`}
            {purchase.expectedAt && open(purchase) && ` · entrega prevista ${formatDay(purchase.expectedAt)}`}
          </p>
          {(purchase.status === "CLOSED" || purchase.status === "CANCELLED") && purchase.closeReason && <p className="text-sm text-red-700">Motivo: {purchase.closeReason}</p>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {purchase.status === "DRAFT" && (
              <Button disabled={send.isPending || purchase.lines.length === 0} onClick={() => send.mutate()} title={purchase.lines.length === 0 ? "Acrescenta pelo menos uma linha" : undefined}>
                Marcar como enviada
              </Button>
            )}
            {purchase.status === "SENT" && <Button onClick={() => setDialog("receive")}>Registar receção</Button>}
            {purchase.status === "SENT" && anyReceived && (
              <Button variant="outline" className="text-red-700" onClick={() => setDialog("close")}>
                Fechar com falta
              </Button>
            )}
            {open(purchase) && !anyReceived && (
              <Button variant="outline" className="text-red-700" onClick={() => setDialog("cancel")}>
                Cancelar compra
              </Button>
            )}
            {purchase.status === "DRAFT" &&
              (confirmDelete ? (
                <span className="flex items-center gap-1 text-sm">
                  Apagar o rascunho?
                  <Button variant="outline" className="text-red-700" disabled={remove.isPending} onClick={() => remove.mutate()}>
                    Apagar
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                    Não
                  </Button>
                </span>
              ) : (
                <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                  Apagar
                </Button>
              ))}
          </div>
        )}
      </div>
      {send.isError && <p className="text-sm text-red-600">{errorMessage(send.error, "Não foi possível marcar como enviada.")}</p>}
      {remove.isError && <p className="text-sm text-red-600">{errorMessage(remove.error, "Não foi possível apagar.")}</p>}
      {purchase.status === "DRAFT" && <p className="text-sm text-muted-foreground">O CRM não envia a compra ao fornecedor: faz o pedido como de costume e marca-a como enviada.</p>}

      <LinesCard purchase={purchase} canEdit={canEdit} seesCosts={seesCosts} onChanged={changed} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <HeaderCard purchase={purchase} canEdit={canEdit} onSaved={changed} />
          <ReceiptsCard purchase={purchase} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Atividade</CardTitle>
          </CardHeader>
          <CardContent>
            <TimelineSection entityType="PURCHASE_ORDER" entityId={purchase.id} />
          </CardContent>
        </Card>
      </div>
      {dialog === "receive" && <ReceiveDialog purchase={purchase} onClose={() => setDialog(null)} onDone={done} />}
      {(dialog === "close" || dialog === "cancel") && <ReasonDialog purchase={purchase} kind={dialog} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}
