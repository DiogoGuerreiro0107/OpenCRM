import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Task, TaskPriority, TaskStatus } from "@opencrm/shared-types";
import { createTask, deleteTask, updateTask } from "@/lib/tasks-api";
import { listWorkItemTypes } from "@/lib/work-item-types-api";
import { TASK_STATUS_LABELS, categoryForStatus } from "./task-labels";
import { STEP_CATEGORY_LABELS } from "@/lib/workflows-api";
import { errorMessage } from "@/lib/errors";
import { CustomFieldsSection } from "@/components/CustomFieldsSection";
import { CompanyPicker, ContactPicker, UserPicker } from "@/components/pickers";
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCanWrite } from "@/lib/useCanWrite";
import { ReadOnlyFieldset } from "@/components/ReadOnly";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

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
  /** Tarefa nova já com tipo (p. ex. na página de um tipo) e, num tipo com passos, já num passo (coluna do quadro). */
  defaultTypeId?: string;
  defaultStepId?: string;
}

function toDateTimeLocal(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function TaskDialog({ open, onClose, task, defaultDueDate, defaultTypeId, defaultStepId }: TaskDialogProps) {
  const queryClient = useQueryClient();
  const readOnly = !useCanWrite("dailyWork");

  const [form, setForm] = useState({
    title: "",
    description: "",
    dueDate: "",
    scheduledStart: "",
    scheduledEnd: "",
    status: "PENDING" as TaskStatus,
    typeId: "",
    stepId: "",
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
      scheduledStart: toDateTimeLocal(task?.scheduledStart),
      scheduledEnd: toDateTimeLocal(task?.scheduledEnd),
      status: task?.status ?? "PENDING",
      typeId: task?.typeId ?? defaultTypeId ?? "",
      stepId: task?.stepId ?? defaultStepId ?? "",
      priority: task?.priority ?? "NORMAL",
      result: task?.result ?? "",
      assigneeId: task?.assigneeId ?? "",
      contactId: task?.contactId ?? "",
      companyId: task?.companyId ?? "",
    });
    setReminders(
      task?.reminders.map((r) => ({ remindAt: toDateTimeLocal(r.remindAt), message: r.message ?? "" })) ?? [],
    );
  }, [open, task, defaultDueDate, defaultTypeId, defaultStepId]);

  // Tipos ativos para escolher; o da tarefa mantém-se na lista mesmo que tenha sido desativado.
  const { data: activeTypes = [] } = useQuery({ queryKey: ["work-item-types", "active"], queryFn: () => listWorkItemTypes(true), enabled: open });
  const typeOptions = task && !activeTypes.some((t) => t.id === task.typeId) ? [...activeTypes, { ...task.type, active: false }] : activeTypes;
  const typeValue = form.typeId || activeTypes.find((t) => t.isDefault)?.id || "TAREFA";
  // Num tipo com passos escolhe-se o passo (o estado vem dele); o passo escolhido só vale se for deste tipo.
  const steps = activeTypes.find((t) => t.id === typeValue)?.steps ?? (task?.typeId === typeValue && task.step ? [task.step] : []);
  const hasSteps = steps.length > 0;
  const stepValue = steps.some((s) => s.id === form.stepId)
    ? form.stepId
    : (steps.find((s) => s.category === categoryForStatus(form.status)) ?? steps[0])?.id ?? "";

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title,
        description: form.description || undefined,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        // Vazio = sem horário marcado (null limpa ao editar).
        scheduledStart: form.scheduledStart ? new Date(form.scheduledStart).toISOString() : null,
        scheduledEnd: form.scheduledStart && form.scheduledEnd ? new Date(form.scheduledEnd).toISOString() : null,
        // Num tipo com passos manda o passo (o servidor deriva o estado); sem passos, o estado.
        ...(hasSteps ? { stepId: stepValue } : { status: form.status }),
        typeId: typeValue,
        priority: form.priority,
        result: form.result || undefined,
        assigneeId: form.assigneeId || undefined,
        // vazio = sem contacto/empresa (null limpa a ligação ao editar)
        contactId: form.contactId || null,
        companyId: form.companyId || null,
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
<ReadOnlyFieldset disabled={readOnly}>
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
          {hasSteps ? (
            <div className="space-y-2">
              <Label htmlFor="stepId">Passo</Label>
              <Select id="stepId" value={stepValue} onChange={handleChange("stepId")}>
                {steps.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({STEP_CATEGORY_LABELS[s.category]})
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="status">Estado</Label>
              <Select id="status" value={form.status} onChange={handleChange("status")}>
                {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="scheduledStart">Marcado para (início)</Label>
            <Input id="scheduledStart" type="datetime-local" value={form.scheduledStart} onChange={handleChange("scheduledStart")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scheduledEnd">Fim</Label>
            <Input id="scheduledEnd" type="datetime-local" value={form.scheduledEnd} min={form.scheduledStart || undefined} disabled={!form.scheduledStart} onChange={handleChange("scheduledEnd")} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="type">Tipo</Label>
            <Select id="type" value={typeValue} onChange={handleChange("typeId")}>
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.active ? "" : " (desativado)"}
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
          <UserPicker
            id="assigneeId"
            value={form.assigneeId}
            onChange={(id) => setForm((prev) => ({ ...prev, assigneeId: id }))}
            emptyLabel="Eu"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="companyId">Empresa</Label>
            <CompanyPicker
              id="companyId"
              value={form.companyId}
              onChange={(id) => setForm((prev) => ({ ...prev, companyId: id }))}
              selectedLabel={task?.companyId === form.companyId ? task?.company?.name : null}
              emptyLabel="Sem empresa"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactId">Contacto</Label>
            <ContactPicker
              id="contactId"
              value={form.contactId}
              onChange={(id) => setForm((prev) => ({ ...prev, contactId: id }))}
              selectedLabel={task?.contactId === form.contactId ? task?.contact?.name : null}
              emptyLabel="Sem contacto"
            />
          </div>
        </div>
        {task?.salesOrder && (
          <p className="text-sm">
            Encomenda:{" "}
            <Link to={`/encomendas/${task.salesOrder.id}`} className="font-mono text-xs hover:underline" onClick={onClose}>
              EN-{String(task.salesOrder.number).padStart(4, "0")}
            </Link>
          </p>
        )}
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

        </ReadOnlyFieldset>

        {task && (
          <div className="space-y-2 border-t border-border pt-3">
            {/* Campos de todas as tarefas e do tipo GUARDADO (mudar o tipo mostra os do novo depois de guardar). */}
            <CustomFieldsSection entityType="WORK_ITEM" entityId={task.id} scopeId={task.typeId} />
          </div>
        )}

        {saveMutation.isError && (
          <p className="text-sm text-red-600">{errorMessage(saveMutation.error, "Não foi possível guardar a tarefa. Tenta novamente.")}</p>
        )}

        {readOnly ? (
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={onClose}>
              Fechar
            </Button>
          </div>
        ) : (
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
        )}
      </form>
    </Dialog>
  );
}
