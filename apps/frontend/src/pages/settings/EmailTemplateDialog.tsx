import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmailTemplate } from "@opencrm/shared-types";
import { createEmailTemplate, deleteEmailTemplate, updateEmailTemplate } from "@/lib/email-templates-api";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface EmailTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  template?: EmailTemplate | null;
}

export function EmailTemplateDialog({ open, onClose, template }: EmailTemplateDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", subject: "", body: "", category: "", active: true });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: template?.name ?? "",
      subject: template?.subject ?? "",
      body: template?.body ?? "",
      category: template?.category ?? "",
      active: template?.active ?? true,
    });
  }, [open, template]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["email-templates"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        subject: form.subject,
        body: form.body,
        category: form.category || undefined,
        active: form.active,
      };
      return template ? updateEmailTemplate(template.id, payload) : createEmailTemplate(payload);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteEmailTemplate(template!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
    };
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{template ? "Editar modelo" : "Novo modelo de email"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="name">Nome *</Label>
          <Input id="name" value={form.name} onChange={handleChange("name")} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="category">Categoria</Label>
          <Input id="category" value={form.category} onChange={handleChange("category")} placeholder="ex: Boas-vindas" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="subject">Assunto *</Label>
          <Input id="subject" value={form.subject} onChange={handleChange("subject")} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="body">Corpo *</Label>
          <Textarea id="body" value={form.body} onChange={handleChange("body")} className="min-h-[160px]" required />
          <p className="text-xs text-muted-foreground">
            Variáveis: {"{nome_cliente}"}, {"{empresa}"}, {"{responsavel}"}, {"{telefone}"}, {"{email}"},{" "}
            {"{link_proposta}"}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={handleChange("active")} />
          Ativo
        </label>

        {saveMutation.isError && (
          <p className="text-sm text-red-600">Não foi possível guardar o modelo. Tenta novamente.</p>
        )}

        <div className="flex justify-between pt-2">
          {template ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (confirm("Eliminar este modelo?")) deleteMutation.mutate();
              }}
            >
              Eliminar
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          )}
          <Button type="submit" disabled={saveMutation.isPending || !form.name.trim() || !form.subject.trim()}>
            {saveMutation.isPending ? "A guardar..." : "Guardar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
