import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { Lead, BusinessArea, LeadKind, LeadMode, LeadStatus } from "@opencrm/shared-types";
import { convertLead, createLead, deleteLead, updateLead, type LeadInput } from "@/lib/leads-api";
import { CompanyPicker, ContactPicker, UserPicker } from "@/components/pickers";
import { errorMessage } from "@/lib/errors";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { TimelineSection } from "@/components/TimelineSection";
import { CallButton } from "@/components/CallButton";
import { useCanWrite } from "@/lib/useCanWrite";
import { ReadOnlyFieldset } from "@/components/ReadOnly";
import { cn } from "@/lib/utils";
import { hasMainContactName, INTEREST_LABELS, STATUS_LABELS } from "./lead-labels";

interface LeadDialogProps {
  open: boolean;
  onClose: () => void;
  lead?: Lead | null;
  /** Modo do módulo: que tipos se podem escolher. */
  mode: LeadMode;
}

const KIND_LABELS: Record<LeadKind, string> = { COMPANY: "Empresa", PERSON: "Pessoa" };

function emptyForm(kind: LeadKind) {
  return {
    kind,
    /** Lead de pessoa: a pessoa. Lead de empresa: o contacto principal (opcional). */
    person: "",
    companyName: "",
    taxId: "",
    jobTitle: "",
    companyId: "",
    contactId: "",
    /** Empresa do contacto escolhido (só para saber se ainda condiz com a empresa escolhida). */
    contactCompanyId: "",
    phone: "",
    email: "",
    source: "",
    interest: "" as BusinessArea | "",
    status: "NOVO" as LeadStatus,
    responsavelId: "",
    nextActionAt: "",
    notes: "",
  };
}

function formFrom(lead: Lead): ReturnType<typeof emptyForm> {
  return {
    kind: lead.kind,
    // Numa lead de empresa sem contacto principal, `name` repete o nome da empresa: o campo fica vazio.
    person: lead.kind === "COMPANY" && !hasMainContactName(lead) ? "" : lead.name,
    companyName: lead.companyName ?? lead.company?.name ?? "",
    taxId: lead.taxId ?? "",
    jobTitle: lead.jobTitle ?? "",
    companyId: lead.companyId ?? "",
    contactId: lead.contactId ?? "",
    contactCompanyId: "",
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    source: lead.source ?? "",
    interest: lead.interest ?? "",
    status: lead.status,
    responsavelId: lead.responsavelId ?? "",
    nextActionAt: lead.nextActionAt ? lead.nextActionAt.slice(0, 10) : "",
    notes: lead.notes ?? "",
  };
}

export function LeadDialog({ open, onClose, lead, mode }: LeadDialogProps) {
  const queryClient = useQueryClient();
  const readOnly = !useCanWrite("leads");
  const navigate = useNavigate();

  const [form, setForm] = useState(() => emptyForm(mode === "PERSON" ? "PERSON" : "COMPANY"));

  useEffect(() => {
    if (!open) return;
    setForm(lead ? formFrom(lead) : emptyForm(mode === "PERSON" ? "PERSON" : "COMPANY"));
  }, [open, lead, mode]);

  const isCompany = form.kind === "COMPANY";
  const isConverted = lead?.status === "CONVERTIDO";
  // O tipo só se escolhe no modo «ambos» (uma lead antiga de outro tipo continua editável, mas não muda de tipo).
  const canChooseKind = mode === "BOTH" && !isConverted;
  const companyName = form.companyName.trim();
  const valid = isCompany ? companyName !== "" : form.person.trim() !== "";

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const person = form.person.trim();
      const payload: LeadInput = {
        kind: form.kind,
        // Sem contacto principal, a lead de empresa guarda o nome da empresa (ver lead-labels.ts).
        name: isCompany ? person || companyName : person,
        companyName: companyName || undefined,
        taxId: form.taxId.trim() || undefined,
        jobTitle: form.jobTitle.trim() || undefined,
        // Ao editar, vazio desliga; ao criar, vazio não manda nada.
        companyId: form.companyId || (lead ? null : undefined),
        contactId: form.contactId || (lead ? null : undefined),
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
      if (result.contact) navigate(`/contactos/${result.contact.id}`);
      else if (result.company) navigate(`/empresas/${result.company.id}`);
    },
  });

  function handleChange(field: keyof ReturnType<typeof emptyForm>) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  /** Escolher uma empresa existente preenche o nome e o NIF a partir dela. */
  function chooseCompany(id: string, company: { name: string; taxId: string | null } | null) {
    setForm((prev) => ({
      ...prev,
      companyId: id,
      companyName: company ? company.name : prev.companyName,
      taxId: company?.taxId ?? prev.taxId,
      // um contacto de outra empresa deixa de fazer sentido
      contactId: company && prev.contactId && prev.contactCompanyId !== id ? "" : prev.contactId,
    }));
  }

  /** Escolher um contacto existente preenche o que estiver vazio e, sem empresa escolhida, usa a do contacto. */
  function chooseContact(
    id: string,
    contact: { name: string; email: string | null; phone: string | null; mobilePhone: string | null; jobTitle: string | null; companyId: string | null; company?: { id: string; name: string } | null } | null,
  ) {
    setForm((prev) => {
      if (!contact) return { ...prev, contactId: "" };
      const company = !prev.companyId && contact.company ? contact.company : null;
      return {
        ...prev,
        contactId: id,
        contactCompanyId: contact.companyId ?? "",
        person: contact.name,
        email: prev.email || contact.email || "",
        phone: prev.phone || contact.phone || contact.mobilePhone || "",
        jobTitle: prev.jobTitle || contact.jobTitle || "",
        companyId: company ? company.id : prev.companyId,
        companyName: company ? company.name : prev.companyName,
      };
    });
  }

  const linkedLocked = isConverted;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{lead ? "Editar lead" : "Novo lead"}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) saveMutation.mutate();
        }}
      >
        <ReadOnlyFieldset disabled={readOnly}>
          {canChooseKind ? (
            <div className="space-y-2">
              <Label>Tipo</Label>
              <div className="inline-flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Tipo de lead">
                {(["COMPANY", "PERSON"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={form.kind === kind}
                    onClick={() => setForm((prev) => ({ ...prev, kind }))}
                    className={cn(
                      "rounded px-3 py-1 text-sm",
                      form.kind === kind ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Lead de {isCompany ? "empresa" : "pessoa"}</p>
          )}

          {isCompany ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="companyId">Empresa existente</Label>
                <CompanyPicker
                  id="companyId"
                  value={form.companyId}
                  onChange={chooseCompany}
                  selectedLabel={lead?.companyId === form.companyId ? lead?.company?.name : null}
                  emptyLabel="— Nova empresa —"
                  disabled={linkedLocked}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="companyName">Nome da empresa *</Label>
                  <Input id="companyName" value={form.companyName} onChange={handleChange("companyName")} disabled={linkedLocked || !!form.companyId} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="taxId">NIF</Label>
                  <Input id="taxId" value={form.taxId} onChange={handleChange("taxId")} disabled={linkedLocked} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactId">Contacto principal</Label>
                {/* Com empresa escolhida, só os contactos dessa empresa. */}
                <ContactPicker
                  id="contactId"
                  value={form.contactId}
                  onChange={chooseContact}
                  companyId={form.companyId || null}
                  selectedLabel={lead?.contactId === form.contactId ? lead?.contact?.name : null}
                  emptyLabel="— Escrever (ou nenhum) —"
                  disabled={linkedLocked}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="person">Nome do contacto</Label>
                  <Input id="person" value={form.person} onChange={handleChange("person")} disabled={linkedLocked || !!form.contactId} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jobTitle">Cargo</Label>
                  <Input id="jobTitle" value={form.jobTitle} onChange={handleChange("jobTitle")} disabled={linkedLocked} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="contactId">Contacto existente</Label>
                <ContactPicker
                  id="contactId"
                  value={form.contactId}
                  onChange={chooseContact}
                  selectedLabel={lead?.contactId === form.contactId ? lead?.contact?.name : null}
                  emptyLabel="— Nova pessoa —"
                  disabled={linkedLocked}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="person">Nome *</Label>
                  <Input id="person" value={form.person} onChange={handleChange("person")} disabled={linkedLocked || !!form.contactId} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="jobTitle">Cargo</Label>
                  <Input id="jobTitle" value={form.jobTitle} onChange={handleChange("jobTitle")} disabled={linkedLocked} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="companyId">Empresa</Label>
                  <CompanyPicker
                    id="companyId"
                    value={form.companyId}
                    onChange={chooseCompany}
                    selectedLabel={lead?.companyId === form.companyId ? lead?.company?.name : null}
                    emptyLabel="— Escrever (ou nenhuma) —"
                    disabled={linkedLocked}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companyName">Nome da empresa</Label>
                  <Input id="companyName" value={form.companyName} onChange={handleChange("companyName")} disabled={linkedLocked || !!form.companyId} />
                </div>
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="phone">Telefone</Label>
              <div className="flex items-center gap-2">
                <Input id="phone" value={form.phone} onChange={handleChange("phone")} disabled={isConverted} />
                {lead && <CallButton phoneNumber={form.phone} dealId={lead.convertedDeal?.id} />}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={handleChange("email")} disabled={isConverted} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="source">Origem</Label>
              <Input id="source" value={form.source} onChange={handleChange("source")} placeholder="site, loja, chamada..." />
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
              <UserPicker
                id="responsavelId"
                value={form.responsavelId}
                onChange={(id) => setForm((prev) => ({ ...prev, responsavelId: id }))}
                emptyLabel="Eu"
              />
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
        </ReadOnlyFieldset>

        {lead && (
          <div className="border-t border-border pt-4">
            <CustomFieldsSection entityType="LEAD" entityId={lead.id} />
          </div>
        )}

        {lead && (
          <div className="border-t border-border pt-4">
            <TimelineSection entityType="LEAD" entityId={lead.id} />
          </div>
        )}

        {saveMutation.isError && (
          <p className="text-sm text-red-600">{errorMessage(saveMutation.error, "Não foi possível guardar o lead. Tenta novamente.")}</p>
        )}
        {convertMutation.isError && (
          <p className="text-sm text-red-600">{errorMessage(convertMutation.error, "Não foi possível converter o lead. Tenta novamente.")}</p>
        )}

        {readOnly ? (
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : (
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
                  title="Usa a empresa e o contacto ligados; senão procura duplicados (NIF, email, telefone) antes de criar"
                  onClick={() => convertMutation.mutate()}
                  disabled={convertMutation.isPending}
                >
                  {convertMutation.isPending ? "A converter..." : "Converter"}
                </Button>
              )}
            </div>
            <Button type="submit" disabled={saveMutation.isPending || !valid}>
              {saveMutation.isPending ? "A guardar..." : "Guardar"}
            </Button>
          </div>
        )}
        {isConverted && lead?.convertedDeal && (
          <p className="text-xs text-muted-foreground">
            Este lead já foi convertido para o negócio "{lead.convertedDeal.title}".
          </p>
        )}
      </form>
    </Dialog>
  );
}
