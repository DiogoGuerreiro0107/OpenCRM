import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Product, SalesOrder, SalesOrderLine } from "@opencrm/shared-types";
import {
  addOrderLine,
  advanceOrder,
  cancelOrder,
  customerName,
  deleteOrder,
  deleteOrderLine,
  getOrder,
  NEXT_STEP,
  type OrderLineInput,
  reserveOrderStock,
  updateOrder,
  updateOrderLine,
} from "@/lib/orders-api";
import { decimalInput, formatMoney, parseDecimal } from "@/lib/products-api";
import { errorMessage } from "@/lib/errors";
import { useCanWrite } from "@/lib/useCanWrite";
import { useModuleEnabled } from "@/lib/useModules";
import { CompanyPicker, ContactPicker, ProductPicker, UserPicker } from "@/components/pickers";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { TimelineSection } from "@/components/TimelineSection";
import { ReadOnlyFieldset } from "@/components/ReadOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderStatusBadge } from "./OrdersListPage";

const pct = (n: number) => `${n.toLocaleString("pt-PT", { maximumFractionDigits: 2 })}%`;
const qty = (n: number) => n.toLocaleString("pt-PT", { maximumFractionDigits: 2 });
/**
 * Stock da linha (Fase 6b), com os módulos «Stock» e «Encomendas» ligados: em rascunho, o disponível do produto;
 * confirmada, o reservado e o que aguarda.
 */
function LineStock({ line, status }: { line: SalesOrderLine; status: SalesOrder["status"] }) {
  const p = line.product;
  if (!p?.tracksStock) return null;
  if (status === "DRAFT") {
    const short = p.available < line.quantity;
    return <div className={`text-xs ${short ? "text-amber-700" : "text-muted-foreground"}`}>Disponível: {qty(p.available)}</div>;
  }
  if (status !== "CONFIRMED") return null;
  if (line.waitingQuantity > 0) {
    return (
      <div className="text-xs font-medium text-amber-700">
        {line.reservedQuantity > 0 ? `Reservado ${qty(line.reservedQuantity)} · ` : ""}aguarda stock: {qty(line.waitingQuantity)}
      </div>
    );
  }
  return <div className="text-xs text-green-700">Reservado {qty(line.reservedQuantity)}</div>;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" }) : null);

// ---- Cabeçalho ----

interface HeaderForm {
  companyId: string;
  contactId: string;
  assigneeId: string;
  customerReference: string;
  deliveryAddress: string;
  notes: string;
}

const headerOf = (o: SalesOrder): HeaderForm => ({
  companyId: o.companyId ?? "",
  contactId: o.contactId ?? "",
  assigneeId: o.assigneeId ?? "",
  customerReference: o.customerReference ?? "",
  deliveryAddress: o.deliveryAddress ?? "",
  notes: o.notes ?? "",
});

function HeaderCard({ order, canEdit, onSaved }: { order: SalesOrder; canEdit: boolean; onSaved: (o: SalesOrder) => void }) {
  const [form, setForm] = useState(() => headerOf(order));
  const [loadedId, setLoadedId] = useState(order.id);
  // O formulário copia a encomenda só ao abrir (ou ao gravar): o tempo real não apaga o que se está a escrever.
  useEffect(() => {
    if (order.id === loadedId) return;
    setForm(headerOf(order));
    setLoadedId(order.id);
  }, [order, loadedId]);
  const draft = order.status === "DRAFT";
  const closed = order.status === "DELIVERED" || order.status === "CANCELLED";
  const save = useMutation({
    mutationFn: () =>
      updateOrder(order.id, {
        ...(draft ? { companyId: form.companyId || null, contactId: form.contactId || null } : {}),
        assigneeId: form.assigneeId || null,
        customerReference: form.customerReference.trim() || null,
        deliveryAddress: form.deliveryAddress.trim() || null,
        notes: form.notes.trim() || null,
      }),
    onSuccess: (o) => {
      setForm(headerOf(o));
      onSaved(o);
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dados da encomenda</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <ReadOnlyFieldset disabled={!canEdit || closed}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="o-company">Empresa</Label>
                <CompanyPicker id="o-company" value={form.companyId} selectedLabel={order.company?.name} disabled={!draft} onChange={(id) => setForm({ ...form, companyId: id, contactId: "" })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-contact">Contacto</Label>
                <ContactPicker id="o-contact" value={form.contactId} selectedLabel={order.contact?.name} disabled={!draft} companyId={form.companyId || null} onChange={(id) => setForm({ ...form, contactId: id })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-assignee">Responsável</Label>
                <UserPicker id="o-assignee" value={form.assigneeId} onChange={(id) => setForm({ ...form, assigneeId: id })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-ref">Referência do cliente</Label>
                <Input id="o-ref" value={form.customerReference} maxLength={100} onChange={(e) => setForm({ ...form, customerReference: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 space-y-1">
              <Label htmlFor="o-address">Morada de entrega</Label>
              <Textarea id="o-address" rows={2} maxLength={1000} value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} />
            </div>
            <div className="mt-3 space-y-1">
              <Label htmlFor="o-notes">Observações</Label>
              <Textarea id="o-notes" rows={3} maxLength={5000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </ReadOnlyFieldset>
          {!draft && !closed && <p className="text-xs text-muted-foreground">O cliente só se muda enquanto a encomenda é rascunho.</p>}
          {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível guardar.")}</p>}
          {save.isSuccess && !save.isPending && <p className="text-sm text-green-700">Guardado.</p>}
          {canEdit && !closed && (
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

interface LineForm {
  productId?: string;
  description: string;
  sku: string;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  vatRate: string;
}

const emptyLine: LineForm = { description: "", sku: "", quantity: "1", unitPrice: "", discountPct: "0", vatRate: "23" };
const lineFormOf = (l: SalesOrderLine): LineForm => ({
  description: l.description,
  sku: l.sku ?? "",
  quantity: decimalInput(l.quantity),
  unitPrice: decimalInput(l.unitPrice),
  discountPct: decimalInput(l.discountPct),
  vatRate: decimalInput(l.vatRate),
});

/** Valida e converte; devolve o erro em texto para mostrar junto da linha. */
function lineInputOf(form: LineForm): { input: OrderLineInput } | { error: string } {
  const quantity = parseDecimal(form.quantity);
  const unitPrice = parseDecimal(form.unitPrice);
  const discountPct = parseDecimal(form.discountPct) ?? 0;
  const vatRate = parseDecimal(form.vatRate);
  if (!form.description.trim()) return { error: "Descreve a linha." };
  if (quantity === null || Number.isNaN(quantity) || quantity <= 0) return { error: "A quantidade tem de ser positiva." };
  if (unitPrice === null || Number.isNaN(unitPrice) || unitPrice < 0) return { error: "Indica o preço sem IVA." };
  if (Number.isNaN(discountPct) || discountPct < 0 || discountPct > 100) return { error: "O desconto vai de 0 a 100%." };
  if (vatRate === null || Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) return { error: "Indica a taxa de IVA." };
  return { input: { productId: form.productId, description: form.description.trim(), sku: form.sku.trim() || null, quantity, unitPrice, discountPct, vatRate } };
}

function LineEditor({
  initial,
  submitLabel,
  saving,
  error,
  onSave,
  onCancel,
  catalog,
}: {
  initial: LineForm;
  submitLabel: string;
  saving: boolean;
  error: unknown;
  onSave: (input: OrderLineInput) => void;
  onCancel?: () => void;
  catalog: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [product, setProduct] = useState<Product | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const pick = (id: string, item: Product | null) => {
    setProduct(item);
    // Escolher preenche a descrição, a referência, o preço e o IVA (editáveis).
    setForm(
      item
        ? { ...form, productId: id, description: item.name, sku: item.sku, unitPrice: decimalInput(item.salePrice), vatRate: decimalInput(item.vatRate) }
        : { ...form, productId: undefined },
    );
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = lineInputOf(form);
        setLocalError("error" in parsed ? parsed.error : null);
        if ("input" in parsed) onSave(parsed.input);
      }}
    >
      {catalog && (
        <ProductPicker aria-label="Produto do catálogo" value={form.productId ?? ""} onChange={pick} selectedLabel={product?.name} emptyLabel="Do catálogo..." className="w-80" />
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7rem_5rem_6rem_4.5rem_4.5rem_auto]">
        <Input aria-label="Descrição" placeholder="Descrição" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="col-span-2 sm:col-span-1" />
        <Input aria-label="Referência" placeholder="Referência" maxLength={64} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        <Input aria-label="Quantidade" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <Input aria-label="Preço sem IVA" placeholder="Preço" inputMode="decimal" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
        <Input aria-label="Desconto %" inputMode="decimal" value={form.discountPct} onChange={(e) => setForm({ ...form, discountPct: e.target.value })} />
        <Input aria-label="IVA %" inputMode="decimal" value={form.vatRate} onChange={(e) => setForm({ ...form, vatRate: e.target.value })} />
        <div className="col-span-2 flex gap-1 sm:col-span-1">
          <Button type="submit" size="sm" disabled={saving}>
            {submitLabel}
          </Button>
          {onCancel && (
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </div>
      </div>
      {(localError || !!error) && <p className="text-xs text-red-600">{localError ?? errorMessage(error, "Não foi possível guardar a linha.")}</p>}
    </form>
  );
}

function LinesCard({ order, canEdit, onChanged }: { order: SalesOrder; canEdit: boolean; onChanged: (o: SalesOrder) => void }) {
  const productsOn = useModuleEnabled("produtos");
  const stockOn = useModuleEnabled("stock");
  const editable = canEdit && order.status === "DRAFT";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addKey, setAddKey] = useState(0);
  const add = useMutation({
    mutationFn: (input: OrderLineInput) => addOrderLine(order.id, input),
    onSuccess: (o) => {
      setAddKey((k) => k + 1);
      onChanged(o);
    },
  });
  const save = useMutation({
    mutationFn: ({ id, input }: { id: string; input: OrderLineInput }) => updateOrderLine(order.id, id, { ...input, productId: undefined }),
    onSuccess: (o) => {
      setEditingId(null);
      onChanged(o);
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteOrderLine(order.id, id), onSuccess: onChanged });

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
                <th className="pb-1 font-medium">Descrição</th>
                <th className="pb-1 text-right font-medium">Qtd.</th>
                <th className="pb-1 text-right font-medium">Preço</th>
                <th className="pb-1 text-right font-medium">Desc.</th>
                <th className="pb-1 text-right font-medium">IVA</th>
                <th className="pb-1 text-right font-medium">Total s/ IVA</th>
                {editable && <th className="pb-1" />}
              </tr>
            </thead>
            <tbody>
              {order.lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-muted-foreground">
                    Sem linhas.
                  </td>
                </tr>
              )}
              {order.lines.map((l) =>
                editingId === l.id ? (
                  <tr key={l.id} className="border-t border-border">
                    <td colSpan={7} className="py-2">
                      <LineEditor initial={lineFormOf(l)} submitLabel="Guardar" saving={save.isPending} error={save.error} catalog={false} onSave={(input) => save.mutate({ id: l.id, input })} onCancel={() => setEditingId(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2">
                      {l.description}
                      {l.sku &&
                        (l.productId && productsOn ? (
                          <Link to={`/produtos/${l.productId}`} className="ml-2 font-mono text-xs text-muted-foreground hover:underline">
                            {l.sku}
                          </Link>
                        ) : (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">{l.sku}</span>
                        ))}
                      {stockOn && <LineStock line={l} status={order.status} />}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{qty(l.quantity)}</td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{formatMoney(l.unitPrice)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{l.discountPct ? pct(l.discountPct) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{pct(l.vatRate)}</td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{formatMoney(l.lineTotal)}</td>
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
            <tfoot className="border-t border-border">
              <tr>
                <td colSpan={5} className="pt-2 text-right text-muted-foreground">
                  Total sem IVA
                </td>
                <td className="whitespace-nowrap pt-2 text-right tabular-nums">{formatMoney(order.subtotal)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="text-right text-muted-foreground">
                  IVA
                </td>
                <td className="whitespace-nowrap text-right tabular-nums">{formatMoney(order.vatTotal)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="text-right font-medium">
                  Total
                </td>
                <td className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(order.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {remove.isError && <p className="text-xs text-red-600">{errorMessage(remove.error, "Não foi possível retirar.")}</p>}
        {editable && (
          <div className="rounded-md border border-dashed border-border p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Acrescentar linha</p>
            <LineEditor key={addKey} initial={emptyLine} submitLabel="Acrescentar" saving={add.isPending} error={add.error} catalog={productsOn} onSave={(input) => add.mutate(input)} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">Valores indicativos, para a equipa: a fatura é emitida no programa de faturação.</p>
      </CardContent>
    </Card>
  );
}

// ---- Estado ----

function CancelDialog({ order, onClose, onDone }: { order: SalesOrder; onClose: () => void; onDone: (o: SalesOrder) => void }) {
  const [reason, setReason] = useState("");
  const cancel = useMutation({ mutationFn: () => cancelOrder(order.id, reason.trim()), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Cancelar {order.code}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) cancel.mutate();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="cancel-reason">Motivo *</Label>
          <Input id="cancel-reason" value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="Ex.: o cliente desistiu" />
        </div>
        <p className="text-xs text-muted-foreground">Uma encomenda cancelada não volta atrás.</p>
        {cancel.isError && <p className="text-sm text-red-600">{errorMessage(cancel.error, "Não foi possível cancelar.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" className="bg-red-700 hover:bg-red-800" disabled={cancel.isPending || !reason.trim()}>
            {cancel.isPending ? "A cancelar..." : "Cancelar encomenda"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Ficha da encomenda (Fase 6a): cabeçalho, linhas (editáveis em rascunho) com os totais, o passo seguinte do estado,
 * cancelar com motivo, campos personalizados e timeline.
 */
export function OrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = useCanWrite("orders");
  const { data: order, isLoading, isError } = useQuery({ queryKey: ["orders", "one", id], queryFn: () => getOrder(id) });
  const [cancelling, setCancelling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmShortage, setConfirmShortage] = useState(false);
  const stockOn = useModuleEnabled("stock");

  const changed = (o: SalesOrder) => {
    queryClient.setQueryData(["orders", "one", id], o);
    queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
  };
  const advance = useMutation({
    mutationFn: ({ step, allowShortage }: { step: Parameters<typeof advanceOrder>[1]; allowShortage?: boolean }) => advanceOrder(id, step, allowShortage ? { allowShortage } : {}),
    onSuccess: (o) => {
      setConfirmShortage(false);
      changed(o);
    },
  });
  const reserve = useMutation({ mutationFn: () => reserveOrderStock(id), onSuccess: changed });
  const remove = useMutation({
    mutationFn: () => deleteOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      navigate("/encomendas");
    },
  });

  if (isLoading) return <p className="text-muted-foreground">A carregar...</p>;
  if (isError || !order) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground">Encomenda não encontrada.</p>
        <Link to="/encomendas" className="text-sm text-primary hover:underline">
          Voltar às encomendas
        </Link>
      </div>
    );
  }
  const next = NEXT_STEP[order.status];
  // Enviar com linhas à espera de stock pede confirmação: o stock fica negativo (Fase 6b).
  const waiting = stockOn && order.status === "CONFIRMED" ? order.waitingLines : 0;
  const canCancel = order.status === "DRAFT" || order.status === "CONFIRMED";
  const dates = [
    ["Criada", when(order.createdAt)],
    ["Confirmada", when(order.confirmedAt)],
    ["Enviada", when(order.shippedAt)],
    ["Entregue", when(order.deliveredAt)],
    ["Cancelada", when(order.cancelledAt)],
  ].filter(([, v]) => v) as Array<[string, string]>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <Link to="/encomendas" className="text-xs text-muted-foreground hover:underline">
            ← Encomendas
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            <span className="font-mono text-base text-muted-foreground">{order.code}</span>
            {customerName(order)}
            <OrderStatusBadge status={order.status} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {dates.map(([label, value]) => `${label} ${value}`).join(" · ")}
            {order.createdBy && ` · por ${order.createdBy.name}`}
          </p>
          {order.status === "CANCELLED" && order.cancelReason && <p className="text-sm text-red-700">Motivo do cancelamento: {order.cancelReason}</p>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {next &&
              (confirmShortage ? (
                <span className="flex flex-wrap items-center gap-1 text-sm">
                  Enviar sem o stock todo? O stock fica negativo.
                  <Button disabled={advance.isPending} onClick={() => advance.mutate({ step: "ship", allowShortage: true })}>
                    Enviar mesmo assim
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmShortage(false)}>
                    Não
                  </Button>
                </span>
              ) : (
                <Button disabled={advance.isPending} onClick={() => (next.step === "ship" && waiting > 0 ? setConfirmShortage(true) : advance.mutate({ step: next.step }))}>
                  {next.label}
                </Button>
              ))}
            {canCancel && (
              <Button variant="outline" className="text-red-700" onClick={() => setCancelling(true)}>
                Cancelar encomenda
              </Button>
            )}
            {order.status === "DRAFT" &&
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
      {advance.isError && <p className="text-sm text-red-600">{errorMessage(advance.error, "Não foi possível mudar o estado.")}</p>}
      {remove.isError && <p className="text-sm text-red-600">{errorMessage(remove.error, "Não foi possível apagar.")}</p>}
      {waiting > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            {waiting === 1 ? "1 linha aguarda stock." : `${waiting} linhas aguardam stock.`} As entradas de stock reservam primeiro para as encomendas confirmadas há mais tempo.
          </span>
          {canEdit && (
            <Button size="sm" variant="outline" disabled={reserve.isPending} onClick={() => reserve.mutate()}>
              {reserve.isPending ? "A reservar..." : "Reservar stock"}
            </Button>
          )}
        </div>
      )}
      {reserve.isError && <p className="text-sm text-red-600">{errorMessage(reserve.error, "Não foi possível reservar.")}</p>}

      <LinesCard order={order} canEdit={canEdit} onChanged={changed} />
      <div className="grid gap-4 lg:grid-cols-2">
        <HeaderCard order={order} canEdit={canEdit} onSaved={changed} />
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Campos personalizados</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomFieldsSection entityType="ORDER" entityId={order.id} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Atividade</CardTitle>
            </CardHeader>
            <CardContent>
              <TimelineSection entityType="ORDER" entityId={order.id} />
            </CardContent>
          </Card>
        </div>
      </div>
      {cancelling && (
        <CancelDialog
          order={order}
          onClose={() => setCancelling(false)}
          onDone={(o) => {
            setCancelling(false);
            changed(o);
          }}
        />
      )}
    </div>
  );
}
