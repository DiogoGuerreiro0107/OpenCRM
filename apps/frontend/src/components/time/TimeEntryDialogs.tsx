import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TimeEntry } from "@opencrm/shared-types";
import { createTimeEntry, deleteTimeEntry, formatDuration, updateTimeEntry } from "@/lib/time-entries-api";
import { errorMessage } from "@/lib/errors";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** ISO → valor de um campo datetime-local (hora local, ao minuto). */
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const fromLocalInput = (value: string) => new Date(value).toISOString();

/**
 * Registo manual (sem `entry`) ou edição de um registo (Fase 4b). Mudar as horas de um registo pede o motivo; a nota e o
 * faturável mudam-se livremente. Um registo a correr só acerta o início (para-se com «Parar»).
 */
export function TimeEntryDialog({ workItemId, entry, onClose }: { workItemId: string; entry?: TimeEntry; onClose: () => void }) {
  const queryClient = useQueryClient();
  const initial = {
    startedAt: toLocalInput(entry?.startedAt),
    endedAt: toLocalInput(entry?.endedAt),
  };
  const [form, setForm] = useState({ ...initial, note: entry?.note ?? "", billable: entry?.billable ?? true, reason: "" });
  const running = !!entry?.running;
  const startChanged = !!entry && form.startedAt !== initial.startedAt;
  const endChanged = !!entry && !running && form.endedAt !== initial.endedAt;
  const needsReason = startChanged || endChanged;
  const preview = form.startedAt && form.endedAt ? (new Date(form.endedAt).getTime() - new Date(form.startedAt).getTime()) / 1000 : null;

  const save = useMutation({
    mutationFn: () =>
      entry
        ? updateTimeEntry(entry.id, {
            startedAt: startChanged ? fromLocalInput(form.startedAt) : undefined,
            endedAt: endChanged ? fromLocalInput(form.endedAt) : undefined,
            note: form.note.trim() || null,
            billable: form.billable,
            reason: needsReason ? form.reason : undefined,
          })
        : createTimeEntry({ workItemId, startedAt: fromLocalInput(form.startedAt), endedAt: fromLocalInput(form.endedAt), note: form.note.trim() || undefined, billable: form.billable }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
      onClose();
    },
  });
  const valid = !!form.startedAt && (running || !!form.endedAt) && (!needsReason || form.reason.trim().length > 0);

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{entry ? "Editar registo de tempo" : "Adicionar tempo"}</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="te-start">Início *</Label>
            <Input id="te-start" type="datetime-local" value={form.startedAt} onChange={(e) => setForm({ ...form, startedAt: e.target.value })} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="te-end">Fim {running ? "" : "*"}</Label>
            {running ? (
              <p className="py-2 text-sm text-muted-foreground">A correr (para-se com «Parar»)</p>
            ) : (
              <Input id="te-end" type="datetime-local" value={form.endedAt} min={form.startedAt || undefined} onChange={(e) => setForm({ ...form, endedAt: e.target.value })} required />
            )}
          </div>
        </div>
        {preview !== null && preview > 0 && <p className="text-xs text-muted-foreground">Duração: {formatDuration(preview)}</p>}
        <div className="space-y-1">
          <Label htmlFor="te-note">Nota</Label>
          <Input id="te-note" value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} />
          Faturável
        </label>
        {needsReason && (
          <div className="space-y-1">
            <Label htmlFor="te-reason">Motivo da alteração das horas *</Label>
            <Input id="te-reason" value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Fica na timeline e na auditoria" required />
          </div>
        )}
        {save.isError && <p className="text-sm text-red-600">{errorMessage(save.error, "Não foi possível guardar.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={save.isPending || !valid}>
            {save.isPending ? "A guardar..." : "Guardar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Apagar um registo de tempo: pede o motivo (fica na timeline e na auditoria). */
export function DeleteTimeEntryDialog({ entry, onClose }: { entry: TimeEntry; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const remove = useMutation({
    mutationFn: () => deleteTimeEntry(entry.id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["time-entries"] });
      queryClient.invalidateQueries({ queryKey: ["timeline"] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>Apagar registo de tempo</DialogTitle>
      </DialogHeader>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          remove.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          {entry.user.name}, {formatDuration(entry.durationSeconds)}
          {entry.running ? " (a correr)" : ""}.
        </p>
        <div className="space-y-1">
          <Label htmlFor="te-del-reason">Motivo *</Label>
          <Input id="te-del-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Fica na timeline e na auditoria" required />
        </div>
        {remove.isError && <p className="text-sm text-red-600">{errorMessage(remove.error, "Não foi possível apagar.")}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" className="bg-red-600 hover:bg-red-700" disabled={remove.isPending || !reason.trim()}>
            {remove.isPending ? "A apagar..." : "Apagar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
