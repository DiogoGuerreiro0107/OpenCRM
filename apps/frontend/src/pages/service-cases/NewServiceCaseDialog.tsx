import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ServiceWarranty } from "@opencrm/shared-types";
import { createServiceCase, WARRANTY_OPTIONS } from "@/lib/service-cases-api";
import { errorMessage } from "@/lib/errors";
import { CompanyPicker, ContactPicker, UserPicker } from "@/components/pickers";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** Nova assistência (Fase 4a): cliente, equipamento, problema, responsável e prazo; abre a ficha ao gravar. */
export function NewServiceCaseDialog({ onClose, companyId: initialCompany, contactId: initialContact }: { onClose: () => void; companyId?: string; contactId?: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: "",
    reportedProblem: "",
    brand: "",
    model: "",
    serialNumber: "",
    underWarranty: "UNKNOWN" as ServiceWarranty,
    companyId: initialCompany ?? "",
    contactId: initialContact ?? "",
    assigneeId: "",
    dueDate: "",
  });
  const field = (name: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [name]: e.target.value });

  const save = useMutation({
    mutationFn: () =>
      createServiceCase({
        title: form.title.trim() || undefined,
        reportedProblem: form.reportedProblem,
        brand: form.brand.trim() || undefined,
        model: form.model.trim() || undefined,
        serialNumber: form.serialNumber.trim() || undefined,
        underWarranty: form.underWarranty,
        companyId: form.companyId || undefined,
        contactId: form.contactId || undefined,
        assigneeId: form.assigneeId || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["service-cases"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
      navigate(`/assistencias/${created.workItemId}`);
    },
  });

  return (
    <Dialog open onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Nova assistência</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[75vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="sc-company">Empresa</Label>
            <CompanyPicker id="sc-company" value={form.companyId} onChange={(id) => setForm({ ...form, companyId: id })} emptyLabel="Sem empresa" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-contact">Contacto</Label>
            <ContactPicker id="sc-contact" value={form.contactId} companyId={form.companyId || null} onChange={(id) => setForm({ ...form, contactId: id })} emptyLabel="Sem contacto" />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sc-problem">Problema reportado *</Label>
          <Textarea id="sc-problem" value={form.reportedProblem} onChange={field("reportedProblem")} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sc-title">Título</Label>
          <Input id="sc-title" value={form.title} maxLength={200} onChange={field("title")} placeholder="Por omissão, o início do problema" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="sc-brand">Marca</Label>
            <Input id="sc-brand" value={form.brand} maxLength={120} onChange={field("brand")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-model">Modelo</Label>
            <Input id="sc-model" value={form.model} maxLength={120} onChange={field("model")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-serial">N.º de série</Label>
            <Input id="sc-serial" value={form.serialNumber} maxLength={120} onChange={field("serialNumber")} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="sc-warranty">Em garantia</Label>
            <Select id="sc-warranty" value={form.underWarranty} onChange={field("underWarranty")}>
              {Object.entries(WARRANTY_OPTIONS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-assignee">Responsável</Label>
            <UserPicker id="sc-assignee" value={form.assigneeId} onChange={(id) => setForm({ ...form, assigneeId: id })} emptyLabel="Eu" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sc-due">Prazo</Label>
            <Input id="sc-due" type="datetime-local" value={form.dueDate} onChange={field("dueDate")} />
          </div>
        </div>
        {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível criar a assistência.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending || !form.reportedProblem.trim()}>
            {save.isPending ? "A criar..." : "Criar assistência"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
