import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sendEmail } from "@/lib/email-api";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ComposeEmailDialogProps {
  open: boolean;
  onClose: () => void;
  defaultTo?: string;
  contactId?: string;
  companyId?: string;
}

export function ComposeEmailDialog({ open, onClose, defaultTo, contactId, companyId }: ComposeEmailDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ to: defaultTo ?? "", subject: "", text: "" });

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
