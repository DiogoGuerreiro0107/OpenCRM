import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Product, SalesOrder, SalesOrderLine, Shipment, Task } from "@opencrm/shared-types";
import { listTasks } from "@/lib/tasks-api";
import { TaskDialog } from "@/pages/tasks/TaskDialog";
import { TASK_STATUS_LABELS } from "@/pages/tasks/task-labels";
import {
  addOrderLine,
  advanceOrder,
  cancelOrder,
  customerName,
  deleteOrder,
  deleteOrderLine,
  finishOrder,
  getOrder,
  NEXT_STEP,
  type OrderLineInput,
  reserveOrderStock,
  shipOrder,
  type ShipmentDetailsInput,
  updateOrder,
  updateOrderLine,
  updateShipment,
} from "@/lib/orders-api";
import { decimalInput, formatMoney, parseDecimal } from "@/lib/products-api";
import { errorMessage } from "@/lib/errors";
import { useCanWrite } from "@/lib/useCanWrite";
import { useModuleEnabled } from "@/lib/useModules";
import { CarrierPicker, CompanyPicker, ContactPicker, ProductPicker, UserPicker } from "@/components/pickers";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { TimelineSection } from "@/components/TimelineSection";
import { ReadOnlyFieldset } from "@/components/ReadOnly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderStatusBadge, PartiallyShippedBadge } from "./OrdersListPage";

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
  if (status !== "CONFIRMED" || line.unshippedQuantity <= 0) return null;
  if (line.waitingQuantity > 0) {
    return (
      <div className="text-xs font-medium text-amber-700">
        {line.reservedQuantity > 0 ? `Reservado ${qty(line.reservedQuantity)} · ` : ""}aguarda stock: {qty(line.waitingQuantity)}
        {/* Fase 6c: o que já está em compra do produto (para esta e para as outras encomendas à espera). */}
        {p.onOrder !== undefined && <span className="font-normal text-muted-foreground"> · em compra: {qty(p.onOrder)}</span>}
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
                      {l.shippedQuantity > 0 && l.shippedQuantity < l.quantity && (
                        <div className="text-xs text-muted-foreground">
                          Enviado {qty(l.shippedQuantity)} de {qty(l.quantity)}
                          {order.status !== "CONFIRMED" && ` · não foi: ${qty(l.unshippedQuantity)}`}
                        </div>
                      )}
                      {order.status === "CONFIRMED" && order.partiallyShipped && l.unshippedQuantity <= 0 && <div className="text-xs text-muted-foreground">Enviada</div>}
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

// ---- Expedições (Fase 6d) ----

interface TransportForm {
  carrierId: string;
  carrierName: string | null;
  trackingCode: string;
  packages: string;
  weightKg: string;
  cost: string;
  notes: string;
}

const emptyTransport: TransportForm = { carrierId: "", carrierName: null, trackingCode: "", packages: "", weightKg: "", cost: "", notes: "" };
const transportOf = (s: Shipment): TransportForm => ({
  carrierId: s.carrier?.id ?? "",
  carrierName: s.carrier?.name ?? null,
  trackingCode: s.trackingCode ?? "",
  packages: s.packages === null ? "" : String(s.packages),
  weightKg: decimalInput(s.weightKg),
  cost: s.cost === null ? "" : s.cost.toFixed(2).replace(".", ","),
  notes: s.notes ?? "",
});

/** Números do formulário: vazio = sem valor; texto que não é número = erro (antes de enviar). */
function transportInput(f: TransportForm): { input: ShipmentDetailsInput; problem: string | null } {
  const num = (v: string) => parseDecimal(v);
  const packages = num(f.packages);
  const weightKg = num(f.weightKg);
  const cost = num(f.cost);
  let problem: string | null = null;
  if (packages !== null && (!Number.isInteger(packages) || packages < 1)) problem = "Os volumes são um número inteiro, pelo menos 1.";
  else if (weightKg !== null && (Number.isNaN(weightKg) || weightKg < 0)) problem = "O peso não é válido.";
  else if (cost !== null && (Number.isNaN(cost) || cost < 0)) problem = "O custo não é válido.";
  return {
    input: { carrierId: f.carrierId || null, trackingCode: f.trackingCode.trim() || null, packages, weightKg, cost, notes: f.notes.trim() || null },
    problem,
  };
}

function TransportFields({ form, onChange }: { form: TransportForm; onChange: (f: TransportForm) => void }) {
  const set = (patch: Partial<TransportForm>) => onChange({ ...form, ...patch });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="ship-carrier">Transportadora</Label>
        <CarrierPicker id="ship-carrier" value={form.carrierId} selectedLabel={form.carrierName} allowEmpty onChange={(carrierId, c) => set({ carrierId, carrierName: c?.name ?? null })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ship-code">Código de seguimento</Label>
        <Input id="ship-code" value={form.trackingCode} maxLength={100} onChange={(e) => set({ trackingCode: e.target.value })} />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:col-span-2">
        <div className="space-y-1">
          <Label htmlFor="ship-packages">Volumes</Label>
          <Input id="ship-packages" inputMode="numeric" value={form.packages} onChange={(e) => set({ packages: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ship-weight">Peso (kg)</Label>
          <Input id="ship-weight" inputMode="decimal" value={form.weightKg} onChange={(e) => set({ weightKg: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ship-cost">Custo (€)</Label>
          <Input id="ship-cost" inputMode="decimal" value={form.cost} onChange={(e) => set({ cost: e.target.value })} />
        </div>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="ship-notes">Notas</Label>
        <Input id="ship-notes" value={form.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} />
      </div>
    </div>
  );
}

/**
 * «Marcar como enviada» (Fase 6d): uma expedição com tudo o que falta enviar ou, com «Enviar só parte», as quantidades
 * de cada linha (por omissão, o reservado nas linhas de stock e o que falta nas outras). Enviar sem o stock reservado
 * pede «Enviar mesmo assim» (o stock fica negativo).
 */
function ShipDialog({ order, stockOn, onClose, onDone }: { order: SalesOrder; stockOn: boolean; onClose: () => void; onDone: (o: SalesOrder) => void }) {
  const open = order.lines.filter((l) => l.unshippedQuantity > 0);
  const tracked = (l: SalesOrderLine) => stockOn && !!l.product?.tracksStock;
  const [form, setForm] = useState<TransportForm>(emptyTransport);
  const [partial, setPartial] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((l) => [l.id, decimalInput(tracked(l) ? Math.min(l.unshippedQuantity, l.reservedQuantity) : l.unshippedQuantity)])),
  );
  const [allowShortage, setAllowShortage] = useState(false);

  const picks = partial
    ? open.map((l) => ({ line: l, quantity: parseDecimal(quantities[l.id] ?? "") ?? 0 })).filter((p) => p.quantity !== 0)
    : open.map((l) => ({ line: l, quantity: l.unshippedQuantity }));
  const badQuantity = picks.find((p) => Number.isNaN(p.quantity) || p.quantity < 0 || p.quantity > p.line.unshippedQuantity || Math.round(p.quantity * 100) !== p.quantity * 100);
  const short = picks.filter((p) => tracked(p.line) && p.quantity > p.line.reservedQuantity);
  const { input, problem } = transportInput(form);
  const blocked = problem ?? (badQuantity ? `${badQuantity.line.description}: só falta enviar ${qty(badQuantity.line.unshippedQuantity)}.` : picks.length === 0 ? "Indica o que vai neste envio." : null);

  const ship = useMutation({
    mutationFn: () =>
      shipOrder(order.id, {
        ...input,
        carrierId: input.carrierId ?? undefined,
        allowShortage: short.length > 0 ? allowShortage : undefined,
        lines: partial ? picks.map((p) => ({ lineId: p.line.id, quantity: p.quantity })) : undefined,
      }),
    onSuccess: onDone,
  });
  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Enviar {order.code}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked && (short.length === 0 || allowShortage)) ship.mutate();
        }}
      >
        <TransportFields form={form} onChange={setForm} />
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />
            Enviar só parte
          </label>
          {partial ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1 font-medium">Linha</th>
                  <th className="pb-1 text-right font-medium">Por enviar</th>
                  <th className="pb-1 text-right font-medium">A enviar</th>
                </tr>
              </thead>
              <tbody>
                {open.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="py-1 pr-2">
                      {l.description}
                      {tracked(l) && <div className="text-xs text-muted-foreground">Reservado {qty(l.reservedQuantity)}</div>}
                    </td>
                    <td className="py-1 text-right tabular-nums">{qty(l.unshippedQuantity)}</td>
                    <td className="w-28 py-1 pl-2">
                      <Input
                        aria-label={`Quantidade a enviar de ${l.description}`}
                        inputMode="decimal"
                        className="h-8 text-right"
                        value={quantities[l.id] ?? ""}
                        onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-muted-foreground">Vai tudo o que falta enviar ({open.length === 1 ? "1 linha" : `${open.length} linhas`}).</p>
          )}
        </div>
        {short.length > 0 && (
          <div role="alert" className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p>Sem stock reservado para: {short.map((p) => `${qty(p.quantity - p.line.reservedQuantity)} × ${p.line.description}`).join("; ")}. O stock fica negativo.</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={allowShortage} onChange={(e) => setAllowShortage(e.target.checked)} />
              Enviar mesmo assim
            </label>
          </div>
        )}
        {blocked && <p className="text-sm text-amber-700">{blocked}</p>}
        {ship.isError && <p className="text-sm text-red-600">{errorMessage(ship.error, "Não foi possível registar o envio.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" disabled={ship.isPending || !!blocked || (short.length > 0 && !allowShortage)}>
            {ship.isPending ? "A registar..." : partial ? "Registar envio parcial" : "Marcar como enviada"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Corrigir os dados do transporte de uma expedição (Fase 6d); as quantidades não mudam. */
function ShipmentEditDialog({ order, shipment, onClose, onDone }: { order: SalesOrder; shipment: Shipment; onClose: () => void; onDone: (o: SalesOrder) => void }) {
  const [form, setForm] = useState<TransportForm>(() => transportOf(shipment));
  const { input, problem } = transportInput(form);
  const save = useMutation({ mutationFn: () => updateShipment(order.id, shipment.id, input), onSuccess: onDone });
  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Corrigir a expedição de {when(shipment.shippedAt)}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) save.mutate();
        }}
      >
        <TransportFields form={form} onChange={setForm} />
        <p className="text-xs text-muted-foreground">As quantidades não se corrigem: o stock já saiu. Para acertar o stock, lança um movimento de stock.</p>
        {problem && <p className="text-sm text-amber-700">{problem}</p>}
        {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível guardar.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" disabled={save.isPending || !!problem}>
            {save.isPending ? "A guardar..." : "Guardar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Cartão «Expedições» (Fase 6d): cada envio com o transporte, o link de seguimento e as linhas. */
function ShipmentsCard({ order, canEdit, onChanged }: { order: SalesOrder; canEdit: boolean; onChanged: (o: SalesOrder) => void }) {
  const [editing, setEditing] = useState<Shipment | null>(null);
  if (order.shipments.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Expedições</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border text-sm">
          {order.shipments.map((s, i) => (
            <li key={s.id} className="space-y-1 py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {order.shipments.length > 1 ? `${i + 1}.ª expedição` : "Expedição"} · {when(s.shippedAt)}
                  {s.createdBy && <span className="font-normal text-muted-foreground"> · por {s.createdBy.name}</span>}
                </span>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                    Corrigir
                  </Button>
                )}
              </div>
              <div className="text-muted-foreground">
                {[
                  s.carrier?.name ?? "Sem transportadora",
                  s.packages !== null ? `${s.packages} ${s.packages === 1 ? "volume" : "volumes"}` : null,
                  s.weightKg !== null ? `${qty(s.weightKg)} kg` : null,
                  s.cost !== null ? formatMoney(s.cost) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {s.trackingCode && (
                <div>
                  Código:{" "}
                  {s.trackingUrl ? (
                    <a href={s.trackingUrl} target="_blank" rel="noreferrer noopener" className="font-mono text-primary hover:underline">
                      {s.trackingCode}
                    </a>
                  ) : (
                    <span className="font-mono">{s.trackingCode}</span>
                  )}
                </div>
              )}
              <div className="text-xs text-muted-foreground">{s.lines.map((l) => `${qty(l.quantity)} × ${l.description}`).join("; ")}</div>
              {s.notes && <div className="text-xs">{s.notes}</div>}
            </li>
          ))}
        </ul>
        {editing && (
          <ShipmentEditDialog
            order={order}
            shipment={editing}
            onClose={() => setEditing(null)}
            onDone={(o) => {
              setEditing(null);
              onChanged(o);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** «Dar por enviada sem o resto» (Fase 6d): com parte enviada, o que falta não vai; as reservas do resto libertam-se. */
function FinishDialog({ order, onClose, onDone }: { order: SalesOrder; onClose: () => void; onDone: (o: SalesOrder) => void }) {
  const [reason, setReason] = useState("");
  const finish = useMutation({ mutationFn: () => finishOrder(order.id, reason.trim()), onSuccess: onDone });
  const left = order.lines.filter((l) => l.unshippedQuantity > 0);
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Dar {order.code} por enviada</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) finish.mutate();
        }}
      >
        <p className="text-sm">Não vai: {left.map((l) => `${qty(l.unshippedQuantity)} × ${l.description}`).join("; ")}.</p>
        <div className="space-y-1">
          <Label htmlFor="finish-reason">Motivo *</Label>
          <Input id="finish-reason" value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="Ex.: o cliente já não precisa do resto" />
        </div>
        <p className="text-xs text-muted-foreground">O stock reservado para o resto fica livre para as outras encomendas.</p>
        {finish.isError && <p className="text-sm text-red-600">{errorMessage(finish.error, "Não foi possível concluir.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" disabled={finish.isPending || !reason.trim()}>
            {finish.isPending ? "A guardar..." : "Dar por enviada"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Tarefas «Preparar encomenda» (Fase 6c): criadas quando a encomenda que aguardava stock fica com tudo reservado. */
function PreparationTasksCard({ orderId }: { orderId: string }) {
  const { data } = useQuery({ queryKey: ["tasks", "order", orderId], queryFn: () => listTasks({ salesOrderId: orderId, limit: 10 }) });
  const [open, setOpen] = useState<Task | null>(null);
  if (!data || data.items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tarefas</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {data.items.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <button type="button" className="font-medium hover:underline" onClick={() => setOpen(t)}>
                {t.title}
              </button>
              <span className="text-xs text-muted-foreground">
                {TASK_STATUS_LABELS[t.status]} · {t.assignee.name}
              </span>
            </li>
          ))}
        </ul>
        {open && <TaskDialog open task={open} onClose={() => setOpen(null)} />}
      </CardContent>
    </Card>
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
  const [shipping, setShipping] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const stockOn = useModuleEnabled("stock");
  const ordersOn = useModuleEnabled("encomendas");
  const purchasesOn = useModuleEnabled("compras");

  const changed = (o: SalesOrder) => {
    queryClient.setQueryData(["orders", "one", id], o);
    queryClient.invalidateQueries({ queryKey: ["orders", "list"] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
  };
  const advance = useMutation({ mutationFn: (step: Parameters<typeof advanceOrder>[1]) => advanceOrder(id, step), onSuccess: changed });
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
  const waiting = stockOn && order.status === "CONFIRMED" ? order.waitingLines : 0;
  // Com parte enviada já não se cancela: dá-se por enviada sem o resto (Fase 6d).
  const canCancel = (order.status === "DRAFT" || order.status === "CONFIRMED") && !order.partiallyShipped;
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
            {order.partiallyShipped && <PartiallyShippedBadge />}
          </h1>
          <p className="text-sm text-muted-foreground">
            {dates.map(([label, value]) => `${label} ${value}`).join(" · ")}
            {order.createdBy && ` · por ${order.createdBy.name}`}
          </p>
          {order.status === "CANCELLED" && order.cancelReason && <p className="text-sm text-red-700">Motivo do cancelamento: {order.cancelReason}</p>}
        </div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {next && (
              <Button disabled={advance.isPending} onClick={() => (next.step === "ship" ? setShipping(true) : advance.mutate(next.step))}>
                {next.step === "ship" && order.partiallyShipped ? "Enviar mais" : next.label}
              </Button>
            )}
            {order.partiallyShipped && (
              <Button variant="outline" onClick={() => setFinishing(true)}>
                Dar por enviada sem o resto
              </Button>
            )}
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
          <span className="flex gap-2">
            {purchasesOn && ordersOn && (
              <Link to="/compras/sugestoes" className="self-center text-sm font-medium underline">
                O que comprar
              </Link>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" disabled={reserve.isPending} onClick={() => reserve.mutate()}>
                {reserve.isPending ? "A reservar..." : "Reservar stock"}
              </Button>
            )}
          </span>
        </div>
      )}
      {reserve.isError && <p className="text-sm text-red-600">{errorMessage(reserve.error, "Não foi possível reservar.")}</p>}

      <LinesCard order={order} canEdit={canEdit} onChanged={changed} />
      <ShipmentsCard order={order} canEdit={canEdit} onChanged={changed} />
      <div className="grid gap-4 lg:grid-cols-2">
        <HeaderCard order={order} canEdit={canEdit} onSaved={changed} />
        <div className="space-y-4">
          {stockOn && <PreparationTasksCard orderId={order.id} />}
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
      {shipping && (
        <ShipDialog
          order={order}
          stockOn={stockOn}
          onClose={() => setShipping(false)}
          onDone={(o) => {
            setShipping(false);
            changed(o);
          }}
        />
      )}
      {finishing && (
        <FinishDialog
          order={order}
          onClose={() => setFinishing(false)}
          onDone={(o) => {
            setFinishing(false);
            changed(o);
          }}
        />
      )}
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
