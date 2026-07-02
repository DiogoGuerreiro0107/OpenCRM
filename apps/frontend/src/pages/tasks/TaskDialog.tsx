import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Task, TaskPriority, TaskStatus, TaskType } from "@opencrm/shared-types";
import { createTask, deleteTask, listUsers, updateTask } from "@/lib/tasks-api";
import { listCompanies } from "@/lib/companies-api";
import { listContacts } from "@/lib/contacts-api";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

const STATUS_LABELS: Record<TaskStatus, string> = {
  PENDING: "Pendente",
  IN_PROGRESS: "Em progresso",
  DONE: "Concluída",
};

const TYPE_LABELS: Record<TaskType, string> = {
  CHAMADA: "Chamada",
  EMAIL: "Email",
  VISITA: "Visita",
  PROPOSTA: "Proposta",
  COBRANCA: "Cobrança",
  ASSISTENCIA: "Assistência",
  OUTRO: "Outro",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  BAIXA: "Baixa",
  NORMAL: "Normal",
  ALTA: "Alta",
  URGENTE: "Urgente",
};

interface ReminderRow {
  remindAt: string;
  message: string;
}

interface TaskDialogProps {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaultDueDate?: string;
}

function toDateTimeLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function TaskDialog({ open, onClose, task, defaultDueDate }: TaskDialogProps) {
  const queryClient = useQueryClient();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: listUsers, enabled: open });
  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: () => listCompanies(),
    enabled: open,
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts"],
    queryFn: () => listContacts(),
    enabled: open,
  });

  const [form, setForm] = useState({
    title: "",
    description: "",
    dueDate: "",
    status: "PENDING" as TaskStatus,
    type: "" as TaskType | "",
    priority: "NORMAL" as TaskPriority,
    result: "",
    assigneeId: "",
    contactId: "",
    companyId: "",
  });
  const [reminders, setReminders] = useState<ReminderRow[]>([]);

  useEffect(() => {
    if (!open) return;
    setForm({
      title: task?.title ?? "",
      description: task?.description ?? "",
      dueDate: task ? toDateTimeLocal(task.dueDate) : defaultDueDate ? `${defaultDueDate}T09:00` : "",
      status: task?.status ?? "PENDING",
      type: task?.type ?? "",
      priority: task?.priority ?? "NORMAL",
      result: task?.result ?? "",
      assigneeId: task?.assigneeId ?? "",
      contactId: task?.contactId ?? "",
      companyId: task?.companyId ?? "",
    });
    setReminders(
      task?.reminders.map((r) => ({ remindAt: toDateTimeLocal(r.remindAt), message: r.message ?? "" })) ?? [],
    );
  }, [open, task, defaultDueDate]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title,
        description: form.description || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        status: form.status,
        type: form.type || undefined,
        priority: form.priority,
        result: form.result || undefined,
        assigneeId: form.assigneeId || undefined,
        contactId: form.contactId || undefined,
        companyId: form.companyId || undefined,
        reminders: reminders
          .filter((r) => r.remindAt)
          .map((r) => ({ remindAt: new Date(r.remindAt).toISOString(), message: r.message || undefined })),
      };
      return task ? updateTask(task.id, payload) : createTask(payload);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteTask(task!.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  function handleChange(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  function updateReminder(index: number, patch: Partial<ReminderRow>) {
    setReminders((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{task ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
      </DialogHeader>
      <form
        className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
        onSubmit={(e) => {
          e.preventDefault();
          saveMutation.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="title">Título *</Label>
          <Input id="title" value={form.title} onChange={handleChange("title")} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Descrição</Label>
          <Textarea id="description" value={form.description} onChange={handleChange("description")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="dueDate">Prazo</Label>
            <Input id="dueDate" type="datetime-local" value={form.dueDate} onChange={handleChange("dueDate")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Estado</Label>
            <Select id="status" value={form.status} onChange={handleChange("status")}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
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
            <Label htmlFor="priority">Prioridade</Label>
            <Select id="priority" value={form.priority} onChange={handleChange("priority")}>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="assigneeId">Responsável</Label>
          <Select id="assigneeId" value={form.assigneeId} onChange={handleChange("assigneeId")}>
            <option value="">Eu</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="companyId">Empresa</Label>
            <Select id="companyId" value={form.companyId} onChange={handleChange("companyId")}>
              <option value="">Sem empresa</option>
              {companies?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactId">Contacto</Label>
            <Select id="contactId" value={form.contactId} onChange={handleChange("contactId")}>
              <option value="">Sem contacto</option>
              {contacts?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="result">Resultado</Label>
          <Textarea
            id="result"
            value={form.result}
            onChange={handleChange("result")}
            placeholder="Preenchido ao concluir a tarefa"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Lembretes</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setReminders((prev) => [...prev, { remindAt: "", message: "" }])}
            >
              + Lembrete
            </Button>
          </div>
          {reminders.map((reminder, index) => (
            <div key={index} className="flex gap-2">
              <Input
                type="datetime-local"
                value={reminder.remindAt}
                onChange={(e) => updateReminder(index, { remindAt: e.target.value })}
                className="flex-1"
              />
              <Input
                placeholder="Mensagem (opcional)"
                value={reminder.message}
                onChange={(e) => updateReminder(index, { message: e.target.value })}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReminders((prev) => prev.filter((_, i) => i !== index))}
              >
                Remover
              </Button>
            </div>
          ))}
        </div>

        {saveMutation.isError && (
          <p className="text-sm text-red-600">Não foi possível guardar a tarefa. Tenta novamente.</p>
        )}

        <div className="flex justify-between pt-2">
          {task ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (confirm("Eliminar esta tarefa?")) deleteMutation.mutate();
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
      </form>
    </Dialog>
  );
}
