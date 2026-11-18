import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusinessArea, Deal } from "@opencrm/shared-types";
import { createDeal, deleteDeal, updateDeal } from "@/lib/deals-api";
import { CompanyPicker, ContactPicker } from "@/components/pickers";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCanWrite } from "@/lib/useCanWrite";
import { ReadOnlyFieldset } from "@/components/ReadOnly";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { TimelineSection } from "@/components/TimelineSection";

const TYPE_LABELS: Record<BusinessArea, string> = {
  IMPRESSAO: "Impressão",
  SOFTWARE: "Software",
  INFORMATICA: "Informática",
  PAPELARIA: "Papelaria",
  POS: "POS",
  ASSISTENCIA: "Assistência",
  OUTRO: "Outro",
};

interface DealDialogProps {
  open: boolean;
  onClose: () => void;
  pipelineId: string;
  stageId: string;
  deal?: Deal | null;
}

export function DealDialog({ open, onClose, pipelineId, stageId, deal }: DealDialogProps) {
  const queryClient = useQueryClient();
  const readOnly = !useCanWrite("deals");

  const [form, setForm] = useState({
    title: "",
    value: "0",
    probability: "0",
    type: "" as BusinessArea | "",
    estimatedMargin: "",
    lossReason: "",
    contactId: "",
    companyId: "",
  });

  useEffect(() => {
    if (open) {
      setForm({
        title: deal?.title ?? "",
        value: String(deal?.value ?? 0),
        probability: String(deal?.probability ?? 0),
        type: deal?.type ?? "",
        estimatedMargin: deal?.estimatedMargin != null ? String(deal.estimatedMargin) : "",
        lossReason: deal?.lossReason ?? "",
        contactId: deal?.contactId ?? "",
        companyId: deal?.companyId ?? "",
      });
    }
  }, [open, deal]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["deals", pipelineId] });
    queryClient.invalidateQueries({ queryKey: ["pipelines"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title,
        value: Number(form.value) || 0,
        probability: Number(form.probability) || 0,
        type: form.type || undefined,
        estimatedMargin: form.estimatedMargin ? Number(form.estimatedMargin) : undefined,
        lossReason: form.lossReason || undefined,
        // vazio = sem contacto/empresa (null limpa a ligação ao editar)
        contactId: form.contactId || null,
        companyId: form.companyId || null,
      };
      return deal ? updateDeal(deal.id, payload) : createDeal({ ...payload, pipelineId, stageId });
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDeal(deal!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{deal ? "Editar negócio" : "Novo negócio"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
<ReadOnlyFieldset disabled={readOnly}>
        <div className="space-y-2">
          <Label htmlFor="title">Título *</Label>
          <Input id="title" value={form.title} onChange={handleChange("title")} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="value">Valor (€)</Label>
            <Input id="value" type="number" min="0" step="0.01" value={form.value} onChange={handleChange("value")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="probability">Probabilidade (%)</Label>
            <Input
              id="probability"
              type="number"
              min="0"
              max="100"
              value={form.probability}
              onChange={handleChange("probability")}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="type">Tipo</Label>
            <Select id="type" value={form.type} onChange={handleChange("type")}>
              <option value="">Não definido</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="estimatedMargin">Margem estimada (€)</Label>
            <Input
              id="estimatedMargin"
              type="number"
              min="0"
              step="0.01"
              value={form.estimatedMargin}
              onChange={handleChange("estimatedMargin")}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="companyId">Empresa</Label>
          <CompanyPicker
            id="companyId"
            value={form.companyId}
            onChange={(id) => setForm((prev) => ({ ...prev, companyId: id }))}
            selectedLabel={deal?.companyId === form.companyId ? deal?.company?.name : null}
            emptyLabel="Sem empresa"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contactId">Contacto</Label>
          <ContactPicker
            id="contactId"
            value={form.contactId}
            onChange={(id) => setForm((prev) => ({ ...prev, contactId: id }))}
            selectedLabel={deal?.contactId === form.contactId ? deal?.contact?.name : null}
            emptyLabel="Sem contacto"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lossReason">Motivo de perda</Label>
          <Textarea
            id="lossReason"
            value={form.lossReason}
            onChange={handleChange("lossReason")}
            placeholder="Obrigatório se este negócio for movido para uma fase perdida"
          />
        </div>

        </ReadOnlyFieldset>

        {deal && (
          <div className="border-t border-border pt-4">
            <CustomFieldsSection entityType="DEAL" entityId={deal.id} />
          </div>
        )}

        {deal && (
          <div className="border-t border-border pt-4">
            <TimelineSection entityType="DEAL" entityId={deal.id} />
          </div>
        )}

        {saveMutation.isError && (
          <p className="text-sm text-red-600">Não foi possível guardar o negócio. Tenta novamente.</p>
        )}

        {readOnly ? (
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : (
        <div className="flex justify-between pt-2">
          {deal ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (confirm("Eliminar este negócio?")) deleteMutation.mutate();
              }}
            >
              Eliminar
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={saveMutation.isPending || !form.title.trim()}>
            {saveMutation.isPending ? "A guardar..." : "Guardar"}
          </Button>
        </div>
        )}
      </form>
    </Dialog>
  );
}
