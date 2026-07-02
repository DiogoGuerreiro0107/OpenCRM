import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { Lead, BusinessArea, LeadStatus } from "@opencrm/shared-types";
import { convertLead, createLead, deleteLead, updateLead } from "@/lib/leads-api";
import { listUsers } from "@/lib/tasks-api";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";

const INTEREST_LABELS: Record<BusinessArea, string> = {
  IMPRESSAO: "Impressão",
  SOFTWARE: "Software",
  INFORMATICA: "Informática",
  PAPELARIA: "Papelaria",
  POS: "POS",
  ASSISTENCIA: "Assistência",
  OUTRO: "Outro",
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  NOVO: "Novo",
  CONTACTADO: "Contactado",
  SEM_RESPOSTA: "Sem resposta",
  CONVERTIDO: "Convertido",
  PERDIDO: "Perdido",
};

interface LeadDialogProps {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
}

export function LeadDialog({ open, onClose, lead }: LeadDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: listUsers, enabled: open });

  const [form, setForm] = useState({
    name: "",
    companyName: "",
    phone: "",
    email: "",
    source: "",
    interest: "" as BusinessArea | "",
    status: "NOVO" as LeadStatus,
    responsavelId: "",
    nextActionAt: "",
    notes: "",
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: lead?.name ?? "",
      companyName: lead?.companyName ?? "",
      phone: lead?.phone ?? "",
      email: lead?.email ?? "",
      source: lead?.source ?? "",
      interest: lead?.interest ?? "",
      status: lead?.status ?? "NOVO",
      responsavelId: lead?.responsavelId ?? "",
      nextActionAt: lead?.nextActionAt ? lead.nextActionAt.slice(0, 10) : "",
      notes: lead?.notes ?? "",
    });
  }, [open, lead]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        companyName: form.companyName || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        source: form.source || undefined,
        interest: form.interest || undefined,
        status: form.status,
        responsavelId: form.responsavelId || undefined,
        nextActionAt: form.nextActionAt ? new Date(form.nextActionAt).toISOString() : undefined,
        notes: form.notes || undefined,
      };
      return lead ? updateLead(lead.id, payload) : createLead(payload);
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLead(lead!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const convertMutation = useMutation({
    mutationFn: () => convertLead(lead!.id),
    onSuccess: (result) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      onClose();
      navigate(`/contactos/${result.contact.id}`);
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  const isConverted = lead?.status === "CONVERTIDO";

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{lead ? "Editar lead" : "Novo lead"}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="name">Nome *</Label>
          <Input id="name" value={form.name} onChange={handleChange("name")} required disabled={isConverted} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="companyName">Empresa</Label>
          <Input
            id="companyName"
            value={form.companyName}
            onChange={handleChange("companyName")}
            disabled={isConverted}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <Input id="phone" value={form.phone} onChange={handleChange("phone")} disabled={isConverted} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={form.email} onChange={handleChange("email")} disabled={isConverted} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="source">Origem</Label>
            <Input
              id="source"
              value={form.source}
              onChange={handleChange("source")}
              placeholder="site, loja, chamada..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="interest">Interesse</Label>
            <Select id="interest" value={form.interest} onChange={handleChange("interest")}>
              <option value="">Não definido</option>
              {Object.entries(INTEREST_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="status">Estado</Label>
            <Select id="status" value={form.status} onChange={handleChange("status")} disabled={isConverted}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="responsavelId">Responsável</Label>
            <Select id="responsavelId" value={form.responsavelId} onChange={handleChange("responsavelId")}>
              <option value="">Eu</option>
              {users?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="nextActionAt">Próxima ação</Label>
          <Input id="nextActionAt" type="date" value={form.nextActionAt} onChange={handleChange("nextActionAt")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="notes">Observações</Label>
          <Textarea id="notes" value={form.notes} onChange={handleChange("notes")} />
        </div>

        {lead && (
          <div className="border-t border-border pt-4">
            <CustomFieldsSection entityType="LEAD" entityId={lead.id} />
          </div>
        )}

        {saveMutation.isError && (
          <p className="text-sm text-red-600">Não foi possível guardar o lead. Tenta novamente.</p>
        )}
        {convertMutation.isError && (
          <p className="text-sm text-red-600">Não foi possível converter o lead. Tenta novamente.</p>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-2">
            {lead && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (confirm("Eliminar este lead?")) deleteMutation.mutate();
                }}
              >
                Eliminar
              </Button>
            )}
            {lead && !isConverted && (
              <Button
                type="button"
                variant="outline"
                onClick={() => convertMutation.mutate()}
                disabled={convertMutation.isPending}
              >
                {convertMutation.isPending ? "A converter..." : "Converter"}
              </Button>
            )}
          </div>
          <Button type="submit" disabled={saveMutation.isPending || !form.name.trim() || isConverted}>
            {saveMutation.isPending ? "A guardar..." : "Guardar"}
          </Button>
        </div>
        {isConverted && lead?.convertedDeal && (
          <p className="text-xs text-muted-foreground">
            Este lead já foi convertido para o negócio "{lead.convertedDeal.title}".
          </p>
        )}
      </form>
    </Dialog>
  );
}
