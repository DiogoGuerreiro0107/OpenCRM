import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sendEmail } from "@/lib/email-api";
import { listEmailTemplates } from "@/lib/email-templates-api";
import { getContact } from "@/lib/contacts-api";
import { getCompany } from "@/lib/companies-api";
import { useAuth } from "@/lib/AuthContext";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

interface ComposeEmailDialogProps {
  open: boolean;
  onClose: () => void;
  defaultTo?: string;
  contactId?: string;
  companyId?: string;
}

function applyTemplateVariables(
  text: string,
  vars: { nome_cliente: string; empresa: string; responsavel: string; telefone: string; email: string },
) {
  const replacements: Record<string, string> = {
    "{nome_cliente}": vars.nome_cliente,
    "{empresa}": vars.empresa,
    "{responsavel}": vars.responsavel,
    "{telefone}": vars.telefone,
    "{email}": vars.email,
    "{link_proposta}": "",
  };
  return Object.entries(replacements).reduce((acc, [key, value]) => acc.split(key).join(value), text);
}

export function ComposeEmailDialog({ open, onClose, defaultTo, contactId, companyId }: ComposeEmailDialogProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState({ to: defaultTo ?? "", subject: "", text: "" });
  const [templateId, setTemplateId] = useState("");

  const { data: templates } = useQuery({
    queryKey: ["email-templates"],
    queryFn: listEmailTemplates,
    enabled: open,
  });
  const { data: contact } = useQuery({
    queryKey: ["contacts", contactId],
    queryFn: () => getContact(contactId!),
    enabled: open && !!contactId,
  });
  const { data: company } = useQuery({
    queryKey: ["companies", companyId ?? contact?.companyId ?? undefined],
    queryFn: () => getCompany((companyId ?? contact?.companyId)!),
    enabled: open && !!(companyId ?? contact?.companyId),
  });

  const activeTemplates = templates?.filter((t) => t.active) ?? [];

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = activeTemplates.find((t) => t.id === id);
    if (!template) return;
    const vars = {
      nome_cliente: contact?.name ?? "",
      empresa: company?.name ?? contact?.company?.name ?? "",
      responsavel: user?.name ?? "",
      telefone: contact?.phone ?? "",
      email: contact?.email ?? "",
    };
    setForm((prev) => ({
      ...prev,
      subject: applyTemplateVariables(template.subject, vars),
      text: applyTemplateVariables(template.body, vars),
    }));
  }

  const mutation = useMutation({
    mutationFn: () =>
      sendEmail({
        to: form.to.split(",").map((addr) => addr.trim()).filter(Boolean),
        subject: form.subject,
        text: form.text,
        contactId,
        companyId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-messages"] });
      setForm({ to: "", subject: "", text: "" });
      setTemplateId("");
      onClose();
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Novo email</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="to">Para *</Label>
          <Input
            id="to"
            value={form.to}
            onChange={handleChange("to")}
            placeholder="um@exemplo.pt, outro@exemplo.pt"
            required
          />
        </div>
        {activeTemplates.length > 0 && (
          <div className="space-y-2">
            <Label htmlFor="template">Usar modelo</Label>
            <Select id="template" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Nenhum</option>
              {activeTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="subject">Assunto *</Label>
          <Input id="subject" value={form.subject} onChange={handleChange("subject")} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="text">Mensagem *</Label>
          <Textarea id="text" value={form.text} onChange={handleChange("text")} className="min-h-[160px]" required />
        </div>
        {mutation.isError && (
          <p className="text-sm text-red-600">Não foi possível enviar o email. Verifica a ligação SMTP.</p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={mutation.isPending || !form.to.trim() || !form.subject.trim()}>
            {mutation.isPending ? "A enviar..." : "Enviar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
