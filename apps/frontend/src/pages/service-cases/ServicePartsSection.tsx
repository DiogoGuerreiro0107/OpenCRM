import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServicePart } from "@opencrm/shared-types";
import { createServicePart, deleteServicePart, formatQuantity, listServiceParts, updateServicePart } from "@/lib/service-cases-api";
import { errorMessage } from "@/lib/errors";
import { useCanWrite } from "@/lib/useCanWrite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PartForm {
  description: string;
  reference: string;
  quantity: string;
}

const emptyForm: PartForm = { description: "", reference: "", quantity: "1" };
/** «1,5» ou «1.5» → 1.5; vazio ou inválido → NaN. */
const parseQuantity = (value: string) => Number(value.trim().replace(",", "."));

/** Linha de edição (nova peça ou peça existente). */
function PartRow({ initial, saving, error, onSave, onCancel, submitLabel }: { initial: PartForm; saving: boolean; error: unknown; onSave: (form: PartForm) => void; onCancel?: () => void; submitLabel: string }) {
  const [form, setForm] = useState(initial);
  const quantity = parseQuantity(form.quantity);
  const valid = form.description.trim().length > 0 && quantity > 0;
  return (
    <form
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(form);
      }}
    >
      <div className="grid grid-cols-[4.5rem_1fr_8rem_auto] gap-2">
        <Input aria-label="Quantidade" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
        <Input aria-label="Descrição da peça" placeholder="Descrição da peça" maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <Input aria-label="Referência" placeholder="Referência" maxLength={120} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        <div className="flex gap-1">
          <Button type="submit" size="sm" disabled={saving || !valid}>
            {submitLabel}
          </Button>
          {onCancel && (
            <Button type="button" size="sm" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </div>
      </div>
      {!!error && <p className="text-xs text-red-600">{errorMessage(error, "Não foi possível guardar.")}</p>}
    </form>
  );
}

/**
 * Peças usadas numa assistência (Fase 4c): lista inteira (no máximo 100), adicionar numa linha, editar e retirar. Cada
 * mudança fica na timeline (servidor).
 */
export function ServicePartsSection({ serviceCaseId }: { serviceCaseId: string }) {
  const queryClient = useQueryClient();
  const canEdit = useCanWrite("dailyWork");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [addKey, setAddKey] = useState(0);
  const { data: parts = [], isLoading } = useQuery({ queryKey: ["service-cases", "parts", serviceCaseId], queryFn: () => listServiceParts(serviceCaseId) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["service-cases", "parts", serviceCaseId] });
    queryClient.invalidateQueries({ queryKey: ["timeline"] });
  };
  const toInput = (form: PartForm) => ({ description: form.description.trim(), reference: form.reference.trim(), quantity: parseQuantity(form.quantity) });
  const add = useMutation({
    mutationFn: (form: PartForm) => {
      const input = toInput(form);
      return createServicePart(serviceCaseId, { ...input, reference: input.reference || undefined });
    },
    onSuccess: () => {
      setAddKey((k) => k + 1); // linha nova vazia
      refresh();
    },
  });
  const save = useMutation({
    mutationFn: ({ id, form }: { id: string; form: PartForm }) => {
      const input = toInput(form);
      return updateServicePart(serviceCaseId, id, { ...input, reference: input.reference || null });
    },
    onSuccess: () => {
      setEditingId(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteServicePart(serviceCaseId, id),
    onSuccess: () => {
      setRemovingId(null);
      refresh();
    },
  });

  const formOf = (p: ServicePart): PartForm => ({ description: p.description, reference: p.reference ?? "", quantity: formatQuantity(p.quantity) });

  return (
    <div className="space-y-3">
      {!isLoading && parts.length === 0 && <p className="text-sm text-muted-foreground">Sem peças registadas.</p>}
      <ul className="divide-y divide-border text-sm">
        {parts.map((p) =>
          editingId === p.id ? (
            <li key={p.id} className="py-2">
              <PartRow initial={formOf(p)} saving={save.isPending} error={save.error} submitLabel="Guardar" onSave={(form) => save.mutate({ id: p.id, form })} onCancel={() => setEditingId(null)} />
            </li>
          ) : (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-14 shrink-0 text-right font-mono">{formatQuantity(p.quantity)} ×</span>
              <span className="min-w-0 flex-1">
                {p.description}
                {p.reference && <span className="ml-2 font-mono text-xs text-muted-foreground">{p.reference}</span>}
              </span>
              {canEdit &&
                (removingId === p.id ? (
                  <span className="flex items-center gap-1 text-xs">
                    Retirar?
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-red-700" disabled={remove.isPending} onClick={() => remove.mutate(p.id)}>
                      Sim
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setRemovingId(null)}>
                      Não
                    </Button>
                  </span>
                ) : (
                  <span className="flex gap-1">
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setEditingId(p.id)}>
                      Editar
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-red-700" onClick={() => setRemovingId(p.id)}>
                      Retirar
                    </Button>
                  </span>
                ))}
            </li>
          ),
        )}
      </ul>
      {remove.isError && <p className="text-xs text-red-600">{errorMessage(remove.error, "Não foi possível retirar.")}</p>}
      {canEdit && <PartRow key={addKey} initial={emptyForm} saving={add.isPending} error={add.error} submitLabel="Adicionar" onSave={(form) => add.mutate(form)} />}
    </div>
  );
}
